/**
 * 走行物理モデル
 *
 * 一体型のエアロバイクには「パワーとケイデンスは出すが速度は出さない」機種が多い。
 * その場合ここでパワーと勾配から速度を逆算する。実走の物理に基づくので、
 * 坂を上れば自然に遅くなり、下れば速くなる。
 *
 * シミュレーターと実機の両方から使う。
 */

const G = 9.81;           // 重力加速度 [m/s^2]
const RHO = 1.225;        // 空気密度 [kg/m^3]
const DEFAULT_CRR = 0.005; // 転がり抵抗係数（アスファルト + ロードタイヤ）
const DEFAULT_CDA = 0.32;  // 空気抵抗係数 × 前面投影面積 [m^2]

/**
 * ある速度で走るのに必要なパワー[W]。
 * 転がり抵抗 + 重力（登坂） + 空気抵抗 の合計。
 *
 * @param {number} speedMs   速度 [m/s]
 * @param {number} gradePercent 勾配 [%]
 * @param {number} massKg    ライダー + バイクの総重量 [kg]
 */
export function powerRequired(speedMs, gradePercent, massKg, { crr = DEFAULT_CRR, cda = DEFAULT_CDA } = {}) {
  const slope = gradePercent / 100;
  const rolling = crr * massKg * G;
  const gravity = massKg * G * slope;
  const drag = 0.5 * RHO * cda * speedMs * speedMs;
  return speedMs * (rolling + gravity + drag);
}

/**
 * パワーと勾配から釣り合い速度[km/h]を二分探索で求める。
 *
 * 下り坂では駆動パワーが0でも重力で進むため、下限を0に固定せず
 * 「必要パワーが負になる速度」も解として許容する。
 *
 * @param {number} powerW    出力 [W]
 * @param {number} gradePercent 勾配 [%]
 * @param {number} massKg    総重量 [kg]
 * @returns {number} 速度 [km/h]
 */
export function speedFromPower(powerW, gradePercent = 0, massKg = 80, opts = {}) {
  if (!Number.isFinite(powerW) || powerW < 0) return 0;

  let lo = 0;
  let hi = 30; // 108 km/h。これを超える釣り合いは現実的にない
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (powerRequired(mid, gradePercent, massKg, opts) < powerW) lo = mid;
    else hi = mid;
  }
  return lo * 3.6;
}

/**
 * ホイール回転データから速度[km/h]と距離[m]を求めるための状態機。
 *
 * CSC と Cycling Power の両方で使う。両者はイベント時刻の分解能が違う
 * （CSC = 1/1024秒、Cycling Power = 1/2048秒）ため、生成時に指定する。
 */
export class RevolutionCounter {
  /**
   * @param {object} opts
   * @param {number} opts.timeResolution イベント時刻の1秒あたりのカウント数
   * @param {number} opts.rollover       カウンタが一周する値（uint16 なら 65536）
   */
  constructor({ timeResolution = 1024, rollover = 65536 } = {}) {
    this.timeResolution = timeResolution;
    this.rollover = rollover;
    this.lastRevs = null;
    this.lastTime = null;
    this.staleTicks = 0;
  }

  /**
   * 新しい観測値を入れて、1秒あたりの回転数を返す。
   * 初回や停止中は null を返す（呼び出し側で速度0として扱う）。
   *
   * @param {number} revs 累積回転数
   * @param {number} time イベント時刻（生の値）
   * @returns {number|null} 回転数/秒
   */
  update(revs, time) {
    if (this.lastRevs === null) {
      this.lastRevs = revs;
      this.lastTime = time;
      return null;
    }

    // 時刻カウンタは uint16 で一周するため差分を巻き戻し補正する
    const dt = ((time - this.lastTime + this.rollover) % this.rollover) / this.timeResolution;
    const dRevs = revs - this.lastRevs;

    // 同じイベントの再通知（時刻が進んでいない）は無視する
    if (dt <= 0) {
      this.staleTicks++;
      // 数秒間更新が無ければ停止とみなす
      return this.staleTicks > 8 ? 0 : null;
    }

    this.staleTicks = 0;
    this.lastRevs = revs;
    this.lastTime = time;

    if (dRevs < 0) return null;   // 回転数カウンタが巻き戻った場合は1回スキップ
    if (dt > 10) return 0;        // 長時間の空白は停止とみなす

    return dRevs / dt;
  }

  reset() {
    this.lastRevs = null;
    this.lastTime = null;
    this.staleTicks = 0;
  }
}

/** ホイール回転数/秒 と周長[mm] から速度[km/h] */
export function speedFromWheel(revsPerSec, circumferenceMm) {
  if (revsPerSec === null) return null;
  return (revsPerSec * (circumferenceMm / 1000)) * 3.6;
}

/** クランク回転数/秒 からケイデンス[rpm] */
export function cadenceFromCrank(revsPerSec) {
  if (revsPerSec === null) return null;
  return revsPerSec * 60;
}
