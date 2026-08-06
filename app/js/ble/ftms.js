/**
 * FTMS (Fitness Machine Service) — スマートトレーナー接続
 *
 * Service      0x1826
 * Indoor Bike Data      0x2AD2 (notify)  … 速度・ケイデンス・パワー等
 * Fitness Machine Feature 0x2ACC (read)  … 機種が何を送れるかのビットマップ
 * Control Point         0x2AD9 (write+indicate) … 勾配などの制御
 */

export const FTMS_SERVICE = 0x1826;
const INDOOR_BIKE_DATA = 0x2ad2;
const FITNESS_MACHINE_FEATURE = 0x2acc;
const CONTROL_POINT = 0x2ad9;

// Control Point オペコード
const OP_REQUEST_CONTROL = 0x00;
const OP_START_RESUME = 0x07;
const OP_STOP_PAUSE = 0x08;
const OP_SET_SIMULATION = 0x11;

/**
 * Indoor Bike Data (0x2AD2) をパースする。
 *
 * ⚠️ 最重要: Flags の bit 0 は "More Data" で論理が反転している。
 *    bit 0 が 0 のときに Instantaneous Speed が「存在する」。
 *    ここを取り違えると以降の全フィールドのオフセットがずれる。
 *
 * @param {DataView} view
 * @returns {object} 存在したフィールドのみを持つオブジェクト
 */
export function parseIndoorBikeData(view) {
  const flags = view.getUint16(0, true);
  let o = 2;
  const d = {};

  // bit 0 反転: 0 のとき存在
  if ((flags & 0x0001) === 0) {
    d.speedKmh = view.getUint16(o, true) * 0.01;
    o += 2;
  }
  if (flags & 0x0002) {
    d.avgSpeedKmh = view.getUint16(o, true) * 0.01;
    o += 2;
  }
  if (flags & 0x0004) {
    d.cadenceRpm = view.getUint16(o, true) * 0.5;
    o += 2;
  }
  if (flags & 0x0008) {
    d.avgCadenceRpm = view.getUint16(o, true) * 0.5;
    o += 2;
  }
  if (flags & 0x0010) {
    // uint24 リトルエンディアン
    d.totalDistanceM =
      view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
    o += 3;
  }
  if (flags & 0x0020) {
    d.resistanceLevel = view.getInt16(o, true);
    o += 2;
  }
  if (flags & 0x0040) {
    d.powerW = view.getInt16(o, true);
    o += 2;
  }
  if (flags & 0x0080) {
    d.avgPowerW = view.getInt16(o, true);
    o += 2;
  }
  if (flags & 0x0100) {
    d.totalEnergyKcal = view.getUint16(o, true);
    o += 2;
    d.energyPerHourKcal = view.getUint16(o, true);
    o += 2;
    d.energyPerMinuteKcal = view.getUint8(o);
    o += 1;
  }
  if (flags & 0x0200) {
    d.heartRateBpm = view.getUint8(o);
    o += 1;
  }
  if (flags & 0x0400) {
    d.metabolicEquivalent = view.getUint8(o) * 0.1;
    o += 1;
  }
  if (flags & 0x0800) {
    d.elapsedTimeS = view.getUint16(o, true);
    o += 2;
  }
  if (flags & 0x1000) {
    d.remainingTimeS = view.getUint16(o, true);
    o += 2;
  }
  return d;
}

/**
 * Set Indoor Bike Simulation Parameters (opcode 0x11) のコマンドを組み立てる。
 * 実走の物理条件をトレーナーに伝えることで、坂道でペダルが重くなる。
 *
 * @param {object} p
 * @param {number} p.gradePercent  勾配[%]
 * @param {number} p.windSpeedMs   風速[m/s]
 * @param {number} p.crr           転がり抵抗係数（アスファルト+ロード ≒ 0.004）
 * @param {number} p.cw            空気抵抗係数[kg/m]（ロード前傾 ≒ 0.51）
 * @returns {ArrayBuffer} 7バイト
 */
export function buildSimulationCommand({
  gradePercent = 0,
  windSpeedMs = 0,
  crr = 0.004,
  cw = 0.51,
} = {}) {
  const buf = new ArrayBuffer(7);
  const v = new DataView(buf);
  v.setUint8(0, OP_SET_SIMULATION);
  v.setInt16(1, clampInt(windSpeedMs / 0.001, -32768, 32767), true);
  v.setInt16(3, clampInt(gradePercent / 0.01, -32768, 32767), true);
  v.setUint8(5, clampInt(crr / 0.0001, 0, 255));
  v.setUint8(6, clampInt(cw / 0.01, 0, 255));
  return buf;
}

function clampInt(n, min, max) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Fitness Machine Feature (0x2ACC) から対応機能を読み取る */
export function parseFeatureFlags(view) {
  const machine = view.getUint32(0, true);
  const target = view.byteLength >= 8 ? view.getUint32(4, true) : 0;
  return {
    cadence: !!(machine & (1 << 1)),
    totalDistance: !!(machine & (1 << 2)),
    resistanceLevel: !!(machine & (1 << 7)),
    power: !!(machine & (1 << 14)),
    heartRate: !!(machine & (1 << 10)),
    // Target Setting Features bit 13 = Indoor Bike Simulation Parameters
    simulation: !!(target & (1 << 13)),
    targetPower: !!(target & (1 << 3)),
    targetResistance: !!(target & (1 << 2)),
  };
}

/**
 * スマートトレーナーへの接続を管理する。
 * シミュレーター (simulator.js) と同じインターフェースを実装しており、
 * 走行エンジンからはどちらか区別せずに扱える。
 */
export class FtmsTrainer extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.controlPoint = null;
    this.features = null;
    this.name = '未接続';
    this.connected = false;
    this._lastGradeSentAt = 0;
    this._lastGradeValue = null;
  }

  get isSimulated() {
    return false;
  }

  /** 勾配制御が使えるか（機種が対応し、かつ Control Point がある場合のみ） */
  get supportsGrade() {
    return !!this.controlPoint && this.features?.simulation !== false;
  }

  static get isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  async connect() {
    if (!FtmsTrainer.isSupported) {
      throw new Error(
        'このブラウザは Web Bluetooth に対応していません。PC/Mac の Chrome、または iPhone では WebBLE ブラウザをお使いください。'
      );
    }

    // optionalServices に宣言しないと getPrimaryService が実行時に失敗する
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS_SERVICE] }],
      optionalServices: [FTMS_SERVICE, 0x180d, 0x1818, 0x1816, 0x180a],
    });

    this.device.addEventListener('gattserverdisconnected', () => {
      this.connected = false;
      this.dispatchEvent(new CustomEvent('disconnected'));
    });

    this.server = await this.device.gatt.connect();
    this.name = this.device.name || 'スマートトレーナー';
    const service = await this.server.getPrimaryService(FTMS_SERVICE);

    // 対応機能の判定（無くても走行は継続できるので失敗は握りつぶす）
    try {
      const featureChar = await service.getCharacteristic(FITNESS_MACHINE_FEATURE);
      this.features = parseFeatureFlags(await featureChar.readValue());
    } catch {
      this.features = null;
    }

    // 制御権の取得。非対応機種でも走行自体は成立するため必須にしない
    try {
      this.controlPoint = await service.getCharacteristic(CONTROL_POINT);
      await this.controlPoint.startNotifications().catch(() => {});
      await this._write(new Uint8Array([OP_REQUEST_CONTROL]));
      await this._write(new Uint8Array([OP_START_RESUME]));
    } catch {
      this.controlPoint = null;
    }

    const dataChar = await service.getCharacteristic(INDOOR_BIKE_DATA);
    dataChar.addEventListener('characteristicvaluechanged', (e) => {
      let data;
      try {
        data = parseIndoorBikeData(e.target.value);
      } catch (err) {
        console.warn('Indoor Bike Data の解析に失敗:', err);
        return;
      }
      this.dispatchEvent(new CustomEvent('data', { detail: data }));
    });
    await dataChar.startNotifications();

    this.connected = true;
    this.dispatchEvent(new CustomEvent('connected'));
    return this;
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
   * 勾配をトレーナーへ送る。
   * BLE の書き込みを毎フレーム行うと接続が不安定になるため、
   * 2秒経過 or 0.5%以上の変化があったときだけ送信する。
   */
  async setGrade(gradePercent) {
    if (!this.supportsGrade) return false;
    const now = Date.now();
    const changed =
      this._lastGradeValue === null ||
      Math.abs(gradePercent - this._lastGradeValue) >= 0.5;
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
