/**
 * Cycling Speed and Cadence Service (CSC) — 0x1816
 *
 * 速度・ケイデンスセンサーのほか、FTMS を持たない一体型エアロバイクが
 * こちらだけを実装している場合がある。
 */

export const CSC_SERVICE = 0x1816;
export const CSC_MEASUREMENT = 0x2a5b;

/**
 * CSC Measurement (0x2A5B) をパースする。
 *
 * Flags は uint8。
 *   bit 0 : ホイール回転データあり → uint32 累積回転数 + uint16 最終イベント時刻
 *   bit 1 : クランク回転データあり → uint16 累積回転数 + uint16 最終イベント時刻
 *
 * イベント時刻の単位は 1/1024 秒。
 */
export function parseCscMeasurement(view) {
  const flags = view.getUint8(0);
  let o = 1;
  const d = {};

  if (flags & 0x01) {
    d.cumulativeWheelRevs = view.getUint32(o, true);
    o += 4;
    d.lastWheelEventTime = view.getUint16(o, true);
    o += 2;
  }
  if (flags & 0x02) {
    d.cumulativeCrankRevs = view.getUint16(o, true);
    o += 2;
    d.lastCrankEventTime = view.getUint16(o, true);
    o += 2;
  }
  return d;
}
