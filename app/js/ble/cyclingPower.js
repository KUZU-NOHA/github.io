/**
 * Cycling Power Service (CPS) — 0x1818
 *
 * パワーメーターの標準サービス。一体型エアロバイクの多くは FTMS ではなく
 * こちらでパワーとケイデンスを出す。
 */

export const CYCLING_POWER_SERVICE = 0x1818;
export const CYCLING_POWER_MEASUREMENT = 0x2a63;

/**
 * Cycling Power Measurement (0x2A63) をパースする。
 *
 * Flags は uint16。瞬間パワー(sint16)は必ず存在し、以降は
 * フラグの立っているフィールドだけが順に詰めて並ぶ。
 *
 * ⚠️ ホイールイベント時刻の単位は **1/2048 秒**（CSC の 1/1024 秒とは違う）。
 *    クランクイベント時刻は 1/1024 秒。ここを取り違えると速度が2倍ずれる。
 */
export function parseCyclingPowerMeasurement(view) {
  const flags = view.getUint16(0, true);
  let o = 2;
  const d = {};

  d.powerW = view.getInt16(o, true);
  o += 2;

  if (flags & 0x0001) { // Pedal Power Balance
    d.pedalPowerBalance = view.getUint8(o) * 0.5;
    o += 1;
  }
  // bit 1 は Pedal Power Balance Reference（フィールドを持たない）
  if (flags & 0x0004) { // Accumulated Torque
    d.accumulatedTorque = view.getUint16(o, true) / 32;
    o += 2;
  }
  // bit 3 は Accumulated Torque Source（フィールドを持たない）
  if (flags & 0x0010) { // Wheel Revolution Data
    d.cumulativeWheelRevs = view.getUint32(o, true);
    o += 4;
    d.lastWheelEventTime = view.getUint16(o, true); // 1/2048 秒
    o += 2;
  }
  if (flags & 0x0020) { // Crank Revolution Data
    d.cumulativeCrankRevs = view.getUint16(o, true);
    o += 2;
    d.lastCrankEventTime = view.getUint16(o, true); // 1/1024 秒
    o += 2;
  }
  if (flags & 0x0040) { // Extreme Force Magnitudes
    d.maxForceN = view.getInt16(o, true);
    o += 2;
    d.minForceN = view.getInt16(o, true);
    o += 2;
  }
  if (flags & 0x0080) { // Extreme Torque Magnitudes
    d.maxTorque = view.getInt16(o, true) / 32;
    o += 2;
    d.minTorque = view.getInt16(o, true) / 32;
    o += 2;
  }
  // 以降（角度・エネルギー等）は本アプリでは使わないため読み飛ばす

  return d;
}
