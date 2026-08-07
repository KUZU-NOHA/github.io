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
  WAHOO_CONTROL_CHARACTERISTIC, buildUnlockCommand,
  buildSimModeCommand, buildSimGradeCommand,
} from './wahoo.js';
import {
  RevolutionCounter, Smoother, speedFromWheel, cadenceFromCrank, speedFromPower,
  isPlausibleSpeed, isPlausibleCadence,
} from '../ride/physics.js';

const INDOOR_BIKE_DATA = 0x2ad2;
const FITNESS_MACHINE_FEATURE = 0x2acc;
const CONTROL_POINT = 0x2ad9;
const DEVICE_INFO_SERVICE = 0x180a;

const OP_REQUEST_CONTROL = 0x00;
const OP_START_RESUME = 0x07;
const OP_STOP_PAUSE = 0x08;

/** 接続後に探索する自転車系サービス */
export const BIKE_SERVICES = [
  FTMS_SERVICE,
  CYCLING_POWER_SERVICE,
  CSC_SERVICE,
  HEART_RATE_SERVICE,
  DEVICE_INFO_SERVICE,
];

/**
 * 診断で調べるサービスの一覧。
 *
 * Web Bluetooth は optionalServices に宣言した UUID しかアクセスできないため、
 * 「デバイスが持つ全サービスを列挙する」ことは原理的にできない。
 * そこで、フィットネス機器で使われる標準サービスと、実機でよく見かける
 * メーカー独自サービスをあらかじめ列挙しておく。
 */
export const PROBE_SERVICES = [
  ...BIKE_SERVICES,
  0x180f, // Battery
  0x1814, // Running Speed and Cadence
  0x1819, // Location and Navigation
  0x1816, // CSC（再掲・順序保持のため）
  // メーカー独自サービス（実機で頻出するもの）
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART。安価な機器が独自通信に使う
  '00001623-1212-efde-1623-785feabcd123', // LEGO Wireless (稀)
  'a026ee01-0a7d-4ab3-97fa-f1500f9feb8b', // Wahoo 独自
  '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e', // Tacx 独自
  '00000001-19ca-4651-86e5-fa29dcdd09d1', // Zwift 独自
];

/** 診断結果の表示用にサービス名を引く */
const SERVICE_LABELS = new Map([
  [0x1826, 'FTMS（フィットネス機器）'],
  [0x1818, 'Cycling Power（パワー）'],
  [0x1816, 'CSC（速度・ケイデンス）'],
  [0x180d, 'Heart Rate（心拍）'],
  [0x180a, 'Device Information（機器情報）'],
  [0x180f, 'Battery（電池残量）'],
  [0x1814, 'Running Speed and Cadence'],
  [0x1819, 'Location and Navigation'],
]);

function labelFor(uuid) {
  // Web Bluetooth は 16bit UUID を 128bit 形式に正規化して返す
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i.exec(uuid);
  if (m) {
    const short = parseInt(m[1], 16);
    return SERVICE_LABELS.get(short) ?? `標準サービス 0x${m[1].toUpperCase()}`;
  }
  if (uuid.startsWith('6e400001')) return 'Nordic UART（メーカー独自通信）';
  if (uuid.startsWith('a026ee01')) return 'Wahoo 独自サービス';
  if (uuid.startsWith('6e40fec1')) return 'Tacx 独自サービス';
  if (uuid.startsWith('00000001-19ca')) return 'Zwift 独自サービス';
  return 'メーカー独自サービス';
}

/**
 * デバイスに何が実装されているかを調べる（接続はするが走行はしない）。
 *
 * 「繋がるはずなのにデータが来ない」ときに、機種が何を持っているかを
 * 特定するための機能。結果をそのまま報告してもらえれば対応を判断できる。
 *
 * @param {boolean} acceptAll 全デバイスを一覧に出すか
 * @returns {{name: string, services: Array}}
 */
export async function diagnoseDevice(acceptAll = true) {
  if (!BikeSensor.isSupported) {
    throw new Error('このブラウザは Web Bluetooth に対応していません。');
  }

  const request = acceptAll
    ? { acceptAllDevices: true, optionalServices: PROBE_SERVICES }
    : {
        filters: [FTMS_SERVICE, CYCLING_POWER_SERVICE, CSC_SERVICE, HEART_RATE_SERVICE]
          .map((s) => ({ services: [s] })),
        optionalServices: PROBE_SERVICES,
      };

  const device = await navigator.bluetooth.requestDevice(request);
  const server = await device.gatt.connect();
  const found = [];

  for (const uuid of PROBE_SERVICES) {
    let service;
    try {
      service = await server.getPrimaryService(uuid);
    } catch {
      continue; // このサービスは持っていない
    }
    const entry = { uuid: service.uuid, label: labelFor(service.uuid), characteristics: [] };
    try {
      for (const c of await service.getCharacteristics()) {
        const props = [];
        if (c.properties.read) props.push('read');
        if (c.properties.write) props.push('write');
        if (c.properties.writeWithoutResponse) props.push('writeNR');
        if (c.properties.notify) props.push('notify');
        if (c.properties.indicate) props.push('indicate');
        entry.characteristics.push({ uuid: c.uuid, properties: props });
      }
    } catch { /* 特性を列挙できない場合もある */ }
    found.push(entry);
  }

  try {
    device.gatt.disconnect();
  } catch { /* すでに切断済み */ }

  return { name: device.name || '(名前なし)', id: device.id, services: found };
}

/**
 * 特性に書き込む。応答ありの書き込みに対応していない特性もあるため、
 * 使える方を選ぶ。
 */
async function writeTo(characteristic, buffer) {
  if (characteristic.writeValueWithResponse) {
    await characteristic.writeValueWithResponse(buffer);
  } else {
    await characteristic.writeValue(buffer);
  }
}

export class BikeSensor extends EventTarget {
  /**
   * @param {object} opts
   * @param {number} opts.wheelCircumferenceMm ホイール周長[mm]（CSC で速度を出す場合に使用）
   * @param {number} opts.totalMassKg          ライダー+バイク重量[kg]（パワーから速度を逆算する場合に使用）
   */
  constructor({
    wheelCircumferenceMm = 2105,
    totalMassKg = 80,
    speedSource = 'auto',
  } = {}) {
    super();
    this.wheelCircumferenceMm = wheelCircumferenceMm;
    this.totalMassKg = totalMassKg;
    /** 'auto' | 'power' | 'sensor' */
    this.speedSource = speedSource;
    /** 実際に採用した速度の出どころ。UI 表示用 */
    this.activeSpeedSource = null;

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

    /** FTMS の Control Point が無い機種で使う Wahoo 独自の制御特性 */
    this.wahooControl = null;
    this.usesWahooControl = false;

    this.currentGrade = 0;
    this._lastGradeSentAt = 0;
    this._lastGradeValue = null;

    // CSC / Cycling Power の回転データから速度・ケイデンスを出すための状態
    this._cscWheel = new RevolutionCounter({ timeResolution: 1024 });
    this._cscCrank = new RevolutionCounter({ timeResolution: 1024 });
    this._cpsWheel = new RevolutionCounter({ timeResolution: 2048 });
    this._cpsCrank = new RevolutionCounter({ timeResolution: 1024 });

    // 瞬間値はそのまま出すと暴れるので平滑化する。
    // 速度は表示と映像の両方に効くので強めに、ケイデンスは弱めに。
    // 第2引数は1秒あたりの最大変化量。自転車が物理的に出せない
    // 加減速を禁じることで、単発のノイズが表示を支配するのを防ぐ。
    // 強くこいだときの実走の加速が毎秒7km/h程度なので、10 なら
    // 正常な加速を妨げずノイズだけを抑えられる
    this._speedSmoother = new Smoother(2.5, 10);   // 10 km/h/秒
    this._cadenceSmoother = new Smoother(1.2, 90); // 90 rpm/秒

    // サービスごとの生の観測値。同じ項目が複数から来るため分けて持ち、
    // 配信時に優先順位で解決する
    this._raw = { ftms: {}, cyclingPower: {}, csc: {} };
    this._latest = { speedKmh: 0, cadenceRpm: 0, powerW: 0, heartRateBpm: 0 };
  }

  get isSimulated() {
    return false;
  }

  get supportsGrade() {
    return !!this.controlPoint || !!this.wahooControl;
  }

  static get isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  /** UI に出す、何が使えているかの説明文 */
  get description() {
    const via = [];
    if (this.sources.ftms) via.push('FTMS');
    if (this.sources.cyclingPower) via.push('Cycling Power');
    if (this.sources.csc) via.push('CSC');
    if (this.sources.heartRate) via.push('Heart Rate');

    if (via.length === 0) return '対応するサービスが見つかりませんでした';

    if (this.heartRateOnly) {
      return '心拍のみ取得できました。速度・パワーが取れないため走行には使えません' +
        '（「デバイスを診断」で中身を確認できます）';
    }

    const got = [];
    if (this.provides.power) got.push('パワー');
    if (this.provides.cadence) got.push('ケイデンス');
    if (this.activeSpeedSource === 'power') got.push('速度(パワーから算出)');
    else if (this.activeSpeedSource) got.push('速度');
    else if (this.provides.speed) got.push('速度');
    if (this.provides.heartRate) got.push('心拍');

    const grade = this.controlPoint
      ? ' / 勾配連動に対応（FTMS）'
      : this.wahooControl
        ? ' / 勾配連動に対応（Wahoo 独自プロトコル・実験的）'
        : ' / 勾配連動は非対応';

    return `${via.join(' + ')} で接続 / 取得: ${got.join('・') || '（ペダルを回してください）'}${grade}`;
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
      ? { acceptAllDevices: true, optionalServices: PROBE_SERVICES }
      : {
          // 心拍を含めるのが重要。一体型エアロバイクには FTMS を広告せず
          // 心拍サービスだけを広告する機種があり、心拍を外すと一覧に出てこない。
          // 接続後に FTMS / Cycling Power / CSC を探索するので、
          // ここで拾えさえすれば残りは繋がってから判定できる。
          filters: [FTMS_SERVICE, CYCLING_POWER_SERVICE, CSC_SERVICE, HEART_RATE_SERVICE]
            .map((s) => ({ services: [s] })),
          optionalServices: PROBE_SERVICES,
        };

    this.device = await navigator.bluetooth.requestDevice(request);
    this.device.addEventListener('gattserverdisconnected', () => {
      this.connected = false;
      this.dispatchEvent(new CustomEvent('disconnected'));
    });

    this.server = await this.device.gatt.connect();
    this.name = this.device.name || 'バイク';

    // 使えるサービスは全て有効化して統合する。
    // 「Cycling Power からパワー、CSC から速度・ケイデンス」のように
    // 複数サービスに分かれている機種があるため、どれか1つに絞ってはいけない。
    // 同じ項目が複数から来た場合は _resolve() が優先順位で選ぶ。
    await this._trySetupFtms();
    await this._trySetupCyclingPower();
    await this._trySetupCsc();
    await this._trySetupHeartRate();

    const hasRideData = this.sources.ftms || this.sources.cyclingPower || this.sources.csc;

    if (!hasRideData && !this.sources.heartRate) {
      await this.disconnect();
      throw new Error(
        `「${this.name}」には対応するサービスが見つかりませんでした。` +
        'メーカー独自プロトコルのみの機種の可能性があります。「デバイスを診断」で中身を確認できます。'
      );
    }

    // 心拍しか取れない場合でも接続は維持する。心拍記録には使えるうえ、
    // 「繋がったが走行データが来ない」ことを UI で明示できるほうが親切。
    this.heartRateOnly = !hasRideData;

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
    this._emit('ftms', out);
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

    // FTMS の Control Point が無い機種でも、Cycling Power サービス配下に
    // Wahoo 独自の制御特性を持っていれば勾配連動ができる
    if (!this.controlPoint) await this._trySetupWahooControl(service);
  }

  /**
   * Wahoo 独自のトレーナー制御を有効化する。
   *
   * ⚠️ 非公開プロトコルであり、Wahoo 以外の機種では UUID が同じでも
   *    解釈が異なる可能性がある。失敗しても走行は継続できるよう、
   *    全ての書き込みを try で囲んでいる。
   */
  async _trySetupWahooControl(service) {
    let char;
    try {
      char = await service.getCharacteristic(WAHOO_CONTROL_CHARACTERISTIC);
    } catch {
      return; // この機種は Wahoo 制御を持たない
    }

    try {
      await char.startNotifications().catch(() => {});
      // 解除コマンドを先に送らないと以降の指示を受け付けない
      await writeTo(char, buildUnlockCommand());
      await writeTo(char, buildSimModeCommand(this.totalMassKg));
      this.wahooControl = char;
      this.usesWahooControl = true;
    } catch (err) {
      console.warn('Wahoo 制御の初期化に失敗:', err);
      this.wahooControl = null;
    }
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
    this._emit('cyclingPower', out);
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
    this._emit('csc', out);
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
          this._emit('heartRate', { heartRateBpm: bpm });
        }
      });
      await char.startNotifications();
      this.sources.heartRate = true;
    } catch { /* 無ければ無視 */ }
  }

  /**
   * 観測値を配信する。
   *
   * 同じ項目が複数のサービスから来るため、情報の確からしい順に採用する。
   *   FTMS > Cycling Power > CSC
   * 速度がどこからも取れない機種では、パワーと現在の勾配から逆算して補う。
   *
   * @param {string} source 'ftms' | 'cyclingPower' | 'csc' | 'heartRate'
   * @param {object} partial この通知で得られた値
   */
  _emit(source, partial) {
    if (source === 'heartRate') {
      this._latest.heartRateBpm = partial.heartRateBpm;
    } else {
      Object.assign(this._raw[source], partial);
    }
    this._resolve();
    this.dispatchEvent(new CustomEvent('data', { detail: { ...this._latest } }));
  }

  /** 優先順位に従って各項目の採用値を決める */
  _resolve() {
    const order = ['ftms', 'cyclingPower', 'csc'];
    const pick = (field) => {
      for (const src of order) {
        const v = this._raw[src][field];
        if (Number.isFinite(v)) return v;
      }
      return null;
    };

    const power = pick('powerW');
    if (power !== null) this._latest.powerW = power;

    const cadence = pick('cadenceRpm');
    if (cadence !== null && isPlausibleCadence(cadence)) {
      this._latest.cadenceRpm = this._cadenceSmoother.update(cadence);
    }

    const hr = pick('heartRateBpm');
    if (hr !== null && hr > 0) this._latest.heartRateBpm = hr;

    const raw = this._resolveSpeed(pick('speedKmh'));
    if (raw !== null) {
      this._latest.speedKmh = Math.max(0, this._speedSmoother.update(raw));
    }
  }

  /**
   * 速度の出どころを決める。
   *
   * 【なぜ選べるようにしたか】
   * 一体型エアロバイクの CSC が返す「ホイール回転数」は、実際の車輪ではなく
   * 内部のカウントであることが多い。それにホイール周長を掛けても意味のある
   * 速度にならず、非現実的な値になったり大きく暴れたりする。
   * パワーから逆算する方式は物理的な裏付けがあり、勾配も織り込めるため、
   * パワーが取れる機種ではそちらを既定にする。
   *
   * @param {number|null} sensorSpeed センサー由来の速度[km/h]
   * @returns {number|null} 採用する速度。まだ決められない場合は null
   */
  _resolveSpeed(sensorSpeed) {
    const hasPower = Number.isFinite(this._latest.powerW) && this.provides.power;
    const sensorOk = sensorSpeed !== null && isPlausibleSpeed(sensorSpeed);

    const fromPower = () => {
      this.activeSpeedSource = 'power';
      return speedFromPower(this._latest.powerW, this.currentGrade, this.totalMassKg);
    };

    if (this.speedSource === 'power') {
      return hasPower ? fromPower() : (sensorOk ? (this.activeSpeedSource = 'sensor', sensorSpeed) : null);
    }

    if (this.speedSource === 'sensor') {
      if (sensorOk) {
        this.activeSpeedSource = 'sensor';
        return sensorSpeed;
      }
      return hasPower ? fromPower() : null;
    }

    // auto: FTMS の速度は機器が算出した正規の値なので最優先。
    // それ以外はパワーからの逆算を優先し、無ければセンサー値を使う。
    const ftmsSpeed = this._raw.ftms.speedKmh;
    if (Number.isFinite(ftmsSpeed) && isPlausibleSpeed(ftmsSpeed)) {
      this.activeSpeedSource = 'ftms';
      return ftmsSpeed;
    }
    if (hasPower) return fromPower();
    if (sensorOk) {
      this.activeSpeedSource = 'sensor';
      return sensorSpeed;
    }
    return null;
  }

  async _write(buffer) {
    if (!this.controlPoint) return;
    await writeTo(this.controlPoint, buffer);
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
      if (this.controlPoint) {
        await this._write(buildSimulationCommand({ gradePercent }));
      } else if (this.wahooControl) {
        await writeTo(this.wahooControl, buildSimGradeCommand(gradePercent));
      }
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
