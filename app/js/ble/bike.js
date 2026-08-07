/**
 * バイク接続の統合レイヤ
 *
 * 【重要な設計判断】
 * 当初は FTMS(0x1826) を広告しているデバイスだけをフィルタしていたが、
 * それでは一体型エアロバイクの多くが一覧に出てこない。理由は2つ:
 *
 *   1. 広告パケットにサービス UUID を載せない機種がある
 *      （接続後に GATT を調べれば FTMS を持っている）
 *   2. そもそも FTMS を持たず、Cycling Power(0x1818) や CSC(0x1816) だけの機種がある
 *
 * そこで「デバイスを絞り込まずに接続し、繋がってからサービスを調べて
 * 使えるものを使う」方式に変えた。優先順位は FTMS > Cycling Power > CSC。
 *
 * 速度が取れない機種（パワーとケイデンスのみ）では、パワーと勾配から
 * 速度を逆算する。実走の物理に基づくので坂で自然に減速する。
 */

import {
  FTMS_SERVICE, parseIndoorBikeData, parseFeatureFlags, buildSimulationCommand,
} from './ftms.js';
import { CSC_SERVICE, CSC_MEASUREMENT, parseCscMeasurement } from './csc.js';
import {
  CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT, parseCyclingPowerMeasurement,
} from './cyclingPower.js';
import { HEART_RATE_SERVICE } from './heartRate.js';
import {
  RevolutionCounter, speedFromWheel, cadenceFromCrank, speedFromPower,
} from '../ride/physics.js';

const INDOOR_BIKE_DATA = 0x2ad2;
const FITNESS_MACHINE_FEATURE = 0x2acc;
const CONTROL_POINT = 0x2ad9;
const DEVICE_INFO_SERVICE = 0x180a;

const OP_REQUEST_CONTROL = 0x00;
const OP_START_RESUME = 0x07;
const OP_STOP_PAUSE = 0x08;

/** 接続後に探索する自転車系サービス。requestDevice の optionalServices にも使う */
export const BIKE_SERVICES = [
  FTMS_SERVICE,
  CYCLING_POWER_SERVICE,
  CSC_SERVICE,
  HEART_RATE_SERVICE,
  DEVICE_INFO_SERVICE,
];

export class BikeSensor extends EventTarget {
  /**
   * @param {object} opts
   * @param {number} opts.wheelCircumferenceMm ホイール周長[mm]（CSC で速度を出す場合に使用）
   * @param {number} opts.totalMassKg          ライダー+バイク重量[kg]（パワーから速度を逆算する場合に使用）
   */
  constructor({ wheelCircumferenceMm = 2105, totalMassKg = 80 } = {}) {
    super();
    this.wheelCircumferenceMm = wheelCircumferenceMm;
    this.totalMassKg = totalMassKg;

    this.device = null;
    this.server = null;
    this.controlPoint = null;
    this.features = null;
    this.name = '未接続';
    this.connected = false;

    /** 実際に使えたサービス。UI での説明に使う */
    this.sources = { ftms: false, cyclingPower: false, csc: false, heartRate: false };
    /** 取得できている項目 */
    this.provides = { speed: false, cadence: false, power: false, heartRate: false };

    this.currentGrade = 0;
    this._lastGradeSentAt = 0;
    this._lastGradeValue = null;

    // CSC / Cycling Power の回転データから速度・ケイデンスを出すための状態
    this._cscWheel = new RevolutionCounter({ timeResolution: 1024 });
    this._cscCrank = new RevolutionCounter({ timeResolution: 1024 });
    this._cpsWheel = new RevolutionCounter({ timeResolution: 2048 });
    this._cpsCrank = new RevolutionCounter({ timeResolution: 1024 });

    this._latest = { speedKmh: 0, cadenceRpm: 0, powerW: 0, heartRateBpm: 0 };
  }

  get isSimulated() {
    return false;
  }

  get supportsGrade() {
    return !!this.controlPoint;
  }

  static get isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  /** UI に出す、何が使えているかの説明文 */
  get description() {
    const got = [];
    if (this.provides.power) got.push('パワー');
    if (this.provides.cadence) got.push('ケイデンス');
    if (this.provides.speed) got.push('速度');
    else if (this.provides.power) got.push('速度(パワーから算出)');
    if (this.provides.heartRate) got.push('心拍');

    const via = [];
    if (this.sources.ftms) via.push('FTMS');
    if (this.sources.cyclingPower) via.push('Cycling Power');
    if (this.sources.csc) via.push('CSC');

    if (via.length === 0) return '対応するサービスが見つかりませんでした';
    return `${via.join(' + ')} で接続 / 取得: ${got.join('・') || 'なし'}` +
      (this.supportsGrade ? ' / 勾配連動に対応' : ' / 勾配連動は非対応');
  }

  /**
   * デバイスを選んで接続する。
   *
   * @param {object} opts
   * @param {boolean} opts.acceptAll  true なら周囲の全デバイスを一覧に出す。
   *   サービスを広告しない機種はこちらでないと見つからない。
   */
  async connect({ acceptAll = false } = {}) {
    if (!BikeSensor.isSupported) {
      throw new Error(
        'このブラウザは Web Bluetooth に対応していません。PC/Mac の Chrome、または iPhone では WebBLE ブラウザをお使いください。'
      );
    }

    const request = acceptAll
      ? { acceptAllDevices: true, optionalServices: BIKE_SERVICES }
      : {
          // いずれかの自転車系サービスを広告しているデバイスを出す
          filters: BIKE_SERVICES.slice(0, 3).map((s) => ({ services: [s] })),
          optionalServices: BIKE_SERVICES,
        };

    this.device = await navigator.bluetooth.requestDevice(request);
    this.device.addEventListener('gattserverdisconnected', () => {
      this.connected = false;
      this.dispatchEvent(new CustomEvent('disconnected'));
    });

    this.server = await this.device.gatt.connect();
    this.name = this.device.name || 'バイク';

    // 優先順位順に探索する。FTMS が最も情報量が多く、勾配制御もできる
    await this._trySetupFtms();
    if (!this.sources.ftms) await this._trySetupCyclingPower();
    if (!this.sources.ftms && !this.sources.cyclingPower) await this._trySetupCsc();
    // FTMS でもケイデンスが来ない機種があるので、CSC があれば併用する
    if (this.sources.ftms && !this.provides.cadence) await this._trySetupCsc();
    await this._trySetupHeartRate();

    if (!this.sources.ftms && !this.sources.cyclingPower && !this.sources.csc) {
      await this.disconnect();
      throw new Error(
        `「${this.name}」には対応するサービス（FTMS / Cycling Power / CSC）が見つかりませんでした。` +
        'メーカー独自プロトコルのみの機種の可能性があります。'
      );
    }

    this.connected = true;
    this.dispatchEvent(new CustomEvent('connected'));
    return this;
  }

  async _trySetupFtms() {
    let service;
    try {
      service = await this.server.getPrimaryService(FTMS_SERVICE);
    } catch {
      return; // このデバイスは FTMS を持たない
    }

    try {
      const featureChar = await service.getCharacteristic(FITNESS_MACHINE_FEATURE);
      this.features = parseFeatureFlags(await featureChar.readValue());
    } catch {
      this.features = null;
    }

    // 制御権の取得。非対応でも走行自体は成立するので失敗を許容する
    try {
      this.controlPoint = await service.getCharacteristic(CONTROL_POINT);
      await this.controlPoint.startNotifications().catch(() => {});
      await this._write(new Uint8Array([OP_REQUEST_CONTROL]));
      await this._write(new Uint8Array([OP_START_RESUME]));
    } catch {
      this.controlPoint = null;
    }

    try {
      const dataChar = await service.getCharacteristic(INDOOR_BIKE_DATA);
      dataChar.addEventListener('characteristicvaluechanged', (e) => {
        this._onFtmsData(e.target.value);
      });
      await dataChar.startNotifications();
      this.sources.ftms = true;
    } catch {
      this.controlPoint = null;
    }
  }

  _onFtmsData(view) {
    let d;
    try {
      d = parseIndoorBikeData(view);
    } catch (err) {
      console.warn('Indoor Bike Data の解析に失敗:', err);
      return;
    }
    const out = {};
    if (Number.isFinite(d.speedKmh)) { out.speedKmh = d.speedKmh; this.provides.speed = true; }
    if (Number.isFinite(d.cadenceRpm)) { out.cadenceRpm = d.cadenceRpm; this.provides.cadence = true; }
    if (Number.isFinite(d.powerW)) { out.powerW = d.powerW; this.provides.power = true; }
    if (Number.isFinite(d.heartRateBpm) && d.heartRateBpm > 0) {
      out.heartRateBpm = d.heartRateBpm;
      this.provides.heartRate = true;
    }
    this._emit(out);
  }

  async _trySetupCyclingPower() {
    let service;
    try {
      service = await this.server.getPrimaryService(CYCLING_POWER_SERVICE);
    } catch {
      return;
    }
    try {
      const char = await service.getCharacteristic(CYCLING_POWER_MEASUREMENT);
      char.addEventListener('characteristicvaluechanged', (e) => {
        this._onCyclingPowerData(e.target.value);
      });
      await char.startNotifications();
      this.sources.cyclingPower = true;
    } catch { /* 通知を張れなければ諦める */ }
  }

  _onCyclingPowerData(view) {
    let d;
    try {
      d = parseCyclingPowerMeasurement(view);
    } catch (err) {
      console.warn('Cycling Power Measurement の解析に失敗:', err);
      return;
    }
    const out = {};
    if (Number.isFinite(d.powerW)) { out.powerW = d.powerW; this.provides.power = true; }

    if (d.cumulativeWheelRevs !== undefined) {
      const rps = this._cpsWheel.update(d.cumulativeWheelRevs, d.lastWheelEventTime);
      const kmh = speedFromWheel(rps, this.wheelCircumferenceMm);
      if (kmh !== null) { out.speedKmh = kmh; this.provides.speed = true; }
    }
    if (d.cumulativeCrankRevs !== undefined) {
      const rps = this._cpsCrank.update(d.cumulativeCrankRevs, d.lastCrankEventTime);
      const rpm = cadenceFromCrank(rps);
      if (rpm !== null) { out.cadenceRpm = rpm; this.provides.cadence = true; }
    }
    this._emit(out);
  }

  async _trySetupCsc() {
    let service;
    try {
      service = await this.server.getPrimaryService(CSC_SERVICE);
    } catch {
      return;
    }
    try {
      const char = await service.getCharacteristic(CSC_MEASUREMENT);
      char.addEventListener('characteristicvaluechanged', (e) => {
        this._onCscData(e.target.value);
      });
      await char.startNotifications();
      this.sources.csc = true;
    } catch { /* 通知を張れなければ諦める */ }
  }

  _onCscData(view) {
    let d;
    try {
      d = parseCscMeasurement(view);
    } catch (err) {
      console.warn('CSC Measurement の解析に失敗:', err);
      return;
    }
    const out = {};
    if (d.cumulativeWheelRevs !== undefined) {
      const rps = this._cscWheel.update(d.cumulativeWheelRevs, d.lastWheelEventTime);
      const kmh = speedFromWheel(rps, this.wheelCircumferenceMm);
      if (kmh !== null) { out.speedKmh = kmh; this.provides.speed = true; }
    }
    if (d.cumulativeCrankRevs !== undefined) {
      const rps = this._cscCrank.update(d.cumulativeCrankRevs, d.lastCrankEventTime);
      const rpm = cadenceFromCrank(rps);
      if (rpm !== null) { out.cadenceRpm = rpm; this.provides.cadence = true; }
    }
    this._emit(out);
  }

  /** バイク本体が心拍も中継している場合に拾う（胸ベルトの別接続は heartRate.js 側） */
  async _trySetupHeartRate() {
    let service;
    try {
      service = await this.server.getPrimaryService(HEART_RATE_SERVICE);
    } catch {
      return;
    }
    try {
      const char = await service.getCharacteristic(0x2a37);
      char.addEventListener('characteristicvaluechanged', (e) => {
        const v = e.target.value;
        const flags = v.getUint8(0);
        const bpm = flags & 0x01 ? v.getUint16(1, true) : v.getUint8(1);
        if (bpm > 0) {
          this.provides.heartRate = true;
          this._emit({ heartRateBpm: bpm });
        }
      });
      await char.startNotifications();
      this.sources.heartRate = true;
    } catch { /* 無ければ無視 */ }
  }

  /**
   * 観測値をまとめて配信する。
   * 速度が取れない機種では、パワーと現在の勾配から速度を逆算して補う。
   */
  _emit(partial) {
    Object.assign(this._latest, partial);

    if (!this.provides.speed && this.provides.power) {
      this._latest.speedKmh = speedFromPower(
        this._latest.powerW,
        this.currentGrade,
        this.totalMassKg
      );
    }

    this.dispatchEvent(new CustomEvent('data', { detail: { ...this._latest } }));
  }

  async _write(buffer) {
    if (!this.controlPoint) return;
    if (this.controlPoint.writeValueWithResponse) {
      await this.controlPoint.writeValueWithResponse(buffer);
    } else {
      await this.controlPoint.writeValue(buffer);
    }
  }

  /**
   * 勾配を設定する。
   * Control Point が使えない機種でも、パワーから速度を逆算する際に
   * 勾配を反映させるため値自体は保持する。
   */
  async setGrade(gradePercent) {
    this.currentGrade = gradePercent;
    if (!this.supportsGrade) return false;

    const now = Date.now();
    const changed =
      this._lastGradeValue === null ||
      Math.abs(gradePercent - this._lastGradeValue) >= 0.5;
    // BLE 書き込みの過剰送信は接続を不安定にするので間引く
    if (!changed && now - this._lastGradeSentAt < 2000) return false;

    this._lastGradeSentAt = now;
    this._lastGradeValue = gradePercent;
    try {
      await this._write(buildSimulationCommand({ gradePercent }));
      return true;
    } catch (err) {
      console.warn('勾配の送信に失敗:', err);
      return false;
    }
  }

  async pause() {
    try {
      await this._write(new Uint8Array([OP_STOP_PAUSE]));
    } catch { /* 非対応機種では無視 */ }
  }

  async resume() {
    try {
      await this._write(new Uint8Array([OP_START_RESUME]));
    } catch { /* 非対応機種では無視 */ }
  }

  async disconnect() {
    this.connected = false;
    try {
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } catch { /* すでに切断済み */ }
  }
}
