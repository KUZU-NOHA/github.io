/**
 * Heart Rate Service (0x180D) — 心拍計の接続（任意）
 *
 * トレーナーが心拍を中継しない場合に、胸ベルト等を直接つなぐために使う。
 * ダイエット用途では脂肪燃焼ゾーンの管理に効くため独立して接続できるようにしている。
 */

export const HEART_RATE_SERVICE = 0x180d;
const HEART_RATE_MEASUREMENT = 0x2a37;

/**
 * Heart Rate Measurement (0x2A37) をパースする。
 * Flags の bit 0 が 0 なら uint8、1 なら uint16 で心拍値が入る。
 */
export function parseHeartRate(view) {
  const flags = view.getUint8(0);
  const is16bit = (flags & 0x01) === 1;
  const bpm = is16bit ? view.getUint16(1, true) : view.getUint8(1);
  return { heartRateBpm: bpm };
}

export class HeartRateMonitor extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.name = '未接続';
    this.connected = false;
  }

  static get isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  async connect() {
    if (!HeartRateMonitor.isSupported) {
      throw new Error('このブラウザは Web Bluetooth に対応していません。');
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HEART_RATE_SERVICE] }],
      optionalServices: [HEART_RATE_SERVICE],
    });

    this.device.addEventListener('gattserverdisconnected', () => {
      this.connected = false;
      this.dispatchEvent(new CustomEvent('disconnected'));
    });

    const server = await this.device.gatt.connect();
    this.name = this.device.name || '心拍計';
    const service = await server.getPrimaryService(HEART_RATE_SERVICE);
    const char = await service.getCharacteristic(HEART_RATE_MEASUREMENT);

    char.addEventListener('characteristicvaluechanged', (e) => {
      try {
        this.dispatchEvent(
          new CustomEvent('data', { detail: parseHeartRate(e.target.value) })
        );
      } catch (err) {
        console.warn('心拍データの解析に失敗:', err);
      }
    });
    await char.startNotifications();

    this.connected = true;
    this.dispatchEvent(new CustomEvent('connected'));
    return this;
  }

  async disconnect() {
    this.connected = false;
    try {
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } catch { /* すでに切断済み */ }
  }
}
