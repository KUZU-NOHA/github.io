/**
 * 消費カロリー算出（要件定義書 F-503）
 *
 * パワーが取れる場合と取れない場合で方式が変わる。UI 側では
 * どちらの方式で出した値かを必ず明示すること（精度が大きく違うため）。
 */

/**
 * パワーから消費カロリーを積算する（推奨・実測ベース）。
 *
 * 仕事量 kJ をカロリーに直すには 4.184 で割るが、人体のペダリング効率は
 * 約20〜25%なのでさらに約0.24で割る。この2つがほぼ相殺するため、
 * 結果として kJ の数値がそのまま kcal になる。
 *
 * @param {number} powerW  瞬間パワー[W]
 * @param {number} dtSec   経過時間[秒]
 * @returns {number} この区間の消費カロリー[kcal]
 */
export function kcalFromPower(powerW, dtSec) {
  if (!Number.isFinite(powerW) || powerW <= 0 || dtSec <= 0) return 0;
  return (powerW * dtSec) / 1000; // J → kJ ≒ kcal
}

/** 固定式自転車の METs（Compendium of Physical Activities 準拠の目安） */
export const MET_LIGHT = 5.5;
export const MET_MODERATE = 7.0;
export const MET_VIGOROUS = 10.5;

/**
 * 速度・ケイデンスから運動強度(METs)を推定する。
 * パワー計が無い場合のフォールバック用。
 */
export function estimateMet({ speedKmh = 0, cadenceRpm = 0 } = {}) {
  if (speedKmh < 1 && cadenceRpm < 5) return 0;
  // 速度を主、ケイデンスを従として強度を見積もる
  if (speedKmh >= 28 || cadenceRpm >= 95) return MET_VIGOROUS;
  if (speedKmh >= 18 || cadenceRpm >= 75) return MET_MODERATE;
  return MET_LIGHT;
}

/**
 * METs から消費カロリーを積算する（推定値）。
 *
 * kcal = METs × 体重[kg] × 時間[h] × 1.05
 *
 * @param {number} met
 * @param {number} weightKg
 * @param {number} dtSec
 * @returns {number} この区間の消費カロリー[kcal]
 */
export function kcalFromMet(met, weightKg, dtSec) {
  if (met <= 0 || weightKg <= 0 || dtSec <= 0) return 0;
  return met * weightKg * (dtSec / 3600) * 1.05;
}

/**
 * 心拍ゾーン定義（要件定義書 F-505）。
 * 最大心拍は 220 − 年齢 で推定する。
 */
export const HEART_RATE_ZONES = [
  { key: 'z1', label: 'Z1 回復', min: 0.5, max: 0.6, color: '#7dd3fc' },
  { key: 'z2', label: 'Z2 脂肪燃焼', min: 0.6, max: 0.7, color: '#4ade80' },
  { key: 'z3', label: 'Z3 有酸素', min: 0.7, max: 0.8, color: '#facc15' },
  { key: 'z4', label: 'Z4 閾値', min: 0.8, max: 0.9, color: '#fb923c' },
  { key: 'z5', label: 'Z5 最大', min: 0.9, max: 1.01, color: '#f87171' },
];

export function maxHeartRate(age) {
  return 220 - age;
}

/** 心拍値がどのゾーンかを返す（ゾーン外なら null） */
export function zoneFor(bpm, age) {
  if (!bpm || bpm <= 0) return null;
  const ratio = bpm / maxHeartRate(age);
  return HEART_RATE_ZONES.find((z) => ratio >= z.min && ratio < z.max) ?? null;
}

/**
 * 走行中のカロリーを積算するアキュムレータ。
 * パワーが1度でも観測されたらパワー方式に切り替え、それまでの
 * MET 方式ぶんは破棄せず引き継ぐ（走行途中で方式が変わっても連続する）。
 */
export class CalorieAccumulator {
  constructor({ weightKg = 70 } = {}) {
    this.weightKg = weightKg;
    this.kcal = 0;
    this.kj = 0;
    this.method = 'met'; // 'power' | 'met'
  }

  /**
   * @param {object} sample  {powerW, speedKmh, cadenceRpm}
   * @param {number} dtSec
   */
  add(sample, dtSec) {
    if (dtSec <= 0) return;
    const hasPower = Number.isFinite(sample.powerW) && sample.powerW > 0;
    if (hasPower) {
      this.method = 'power';
      const kj = (sample.powerW * dtSec) / 1000;
      this.kj += kj;
      this.kcal += kj;
    } else if (this.method !== 'power') {
      const met = estimateMet(sample);
      this.kcal += kcalFromMet(met, this.weightKg, dtSec);
    }
  }

  get isEstimate() {
    return this.method !== 'power';
  }
}
