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
 * 時定数つきの平滑化（指数移動平均）。
 *
 * 回転データから求めた瞬間値はそのまま出すと大きく暴れる。
 * 通知の間隔が一定でないため、経過時間を考慮した係数で平滑化する。
 */
export class Smoother {
  /**
   * @param {number} timeConstantSec 追従の時定数[秒]。大きいほど滑らかで反応が鈍い
   * @param {number} maxRatePerSec   1秒あたりの最大変化量。
   *   平滑化だけでは大きな外れ値に引きずられるため、物理的にありえない
   *   変化そのものを禁じる。自転車は 0.2秒で時速70kmも加速できない。
   */
  constructor(timeConstantSec = 2.0, maxRatePerSec = Infinity) {
    this.tau = Math.max(0.05, timeConstantSec);
    this.maxRatePerSec = maxRatePerSec;
    this.value = null;
    this.lastAt = null;
  }

  /**
   * @param {number} sample 新しい観測値
   * @param {number} nowMs  観測時刻（省略時は現在時刻）
   */
  update(sample, nowMs = Date.now()) {
    if (!Number.isFinite(sample)) return this.value;

    if (this.value === null) {
      this.value = sample;
      this.lastAt = nowMs;
      return this.value;
    }

    const dt = Math.max(0, (nowMs - this.lastAt) / 1000);
    this.lastAt = nowMs;

    // dt が長いほど新しい値へ強く追従する
    const alpha = 1 - Math.exp(-dt / this.tau);
    let next = this.value + (sample - this.value) * alpha;

    // 変化率の上限。単発のノイズが表示を支配するのを防ぐ
    if (Number.isFinite(this.maxRatePerSec)) {
      const limit = this.maxRatePerSec * dt;
      const delta = next - this.value;
      if (Math.abs(delta) > limit) {
        next = this.value + Math.sign(delta) * limit;
      }
    }

    this.value = next;
    return this.value;
  }

  reset() {
    this.value = null;
    this.lastAt = null;
  }
}

/**
 * ホイール／クランクの回転データから回転数を求めるための状態機。
 *
 * CSC と Cycling Power の両方で使う。両者はイベント時刻の分解能が違う
 * （CSC = 1/1024秒、Cycling Power = 1/2048秒）ため、生成時に指定する。
 *
 * 【重要】通知2回分の差分だけで瞬間値を出すと、通知間隔が短いときに
 * 値が跳ね上がる（dt が 0.01秒なら回転1回で毎秒100回転になってしまう）。
 * そのため一定時間ぶんの回転をためてから計算する。
 */
export class RevolutionCounter {
  /**
   * @param {object} opts
   * @param {number} opts.timeResolution イベント時刻の1秒あたりのカウント数
   * @param {number} opts.rollover       カウンタが一周する値（uint16 なら 65536）
   * @param {number} opts.minIntervalSec 計算に使う最小の測定窓[秒]
   */
  constructor({ timeResolution = 1024, rollover = 65536, minIntervalSec = 0.5 } = {}) {
    this.timeResolution = timeResolution;
    this.rollover = rollover;
    this.minIntervalSec = minIntervalSec;
    this.lastRevs = null;
    this.lastTime = null;
    this.staleTicks = 0;
    this.lastResult = null;
  }

  /**
   * 新しい観測値を入れて、1秒あたりの回転数を返す。
   * 測定窓が足りない間は直前の結果を保持して返す（暴れを防ぐため）。
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

    // 同じイベントの再通知（時刻が進んでいない）
    if (dt <= 0) {
      this.staleTicks++;
      // しばらく更新が無ければ停止とみなす
      if (this.staleTicks > 8) {
        this.lastResult = 0;
        return 0;
      }
      return this.lastResult;
    }

    if (dRevs < 0) {
      // 回転数カウンタが巻き戻った。基準を取り直す
      this.lastRevs = revs;
      this.lastTime = time;
      return this.lastResult;
    }

    if (dt > 10) {
      // 長時間の空白は停止とみなす
      this.lastRevs = revs;
      this.lastTime = time;
      this.lastResult = 0;
      return 0;
    }

    // 測定窓が短すぎると値が暴れるので、たまるまで待つ
    if (dt < this.minIntervalSec) {
      return this.lastResult;
    }

    this.staleTicks = 0;
    this.lastRevs = revs;
    this.lastTime = time;
    this.lastResult = dRevs / dt;
    return this.lastResult;
  }

  reset() {
    this.lastRevs = null;
    this.lastTime = null;
    this.staleTicks = 0;
    this.lastResult = null;
  }
}

/** 現実にありえない速度は測定ノイズとして弾く */
export const MAX_PLAUSIBLE_SPEED_KMH = 100;

export function isPlausibleSpeed(kmh) {
  return Number.isFinite(kmh) && kmh >= 0 && kmh <= MAX_PLAUSIBLE_SPEED_KMH;
}

/** 現実にありえないケイデンスは測定ノイズとして弾く */
export const MAX_PLAUSIBLE_CADENCE_RPM = 250;

export function isPlausibleCadence(rpm) {
  return Number.isFinite(rpm) && rpm >= 0 && rpm <= MAX_PLAUSIBLE_CADENCE_RPM;
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
