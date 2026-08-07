/**
 * Wahoo 独自トレーナー制御プロトコル
 *
 * Characteristic: a026e005-0a7d-4ab3-97fa-f1500f9feb8b
 *
 * Wahoo は FTMS の Control Point ではなく、Cycling Power サービス配下の
 * 独自特性でトレーナーを制御する。中国系メーカー（HITFIT 等）にも
 * このプロトコルを採用している機種がある。
 *
 * ⚠️ 公式ドキュメントは存在しない。バイト仕様はコミュニティの参照実装
 *    （kinetic-fit/sensors-swift-trainers、GoldenCheetah）に基づく。
 *    Wahoo 以外の機種では、UUID は同じでもコマンドの解釈が異なる、
 *    あるいは一部しか実装されていない可能性がある。
 *    そのため全ての書き込みは失敗しても走行を止めない設計にしている。
 */

export const WAHOO_CONTROL_CHARACTERISTIC =
  'a026e005-0a7d-4ab3-97fa-f1500f9feb8b';

const OP_UNLOCK = 0x20;
const OP_SET_RESISTANCE_MODE = 0x40;
const OP_SET_STANDARD_MODE = 0x41;
const OP_SET_ERG_MODE = 0x42;
const OP_SET_SIM_MODE = 0x43;
const OP_SET_SIM_GRADE = 0x46;
const OP_SET_SIM_WIND = 0x47;

/** 制御を受け付けさせるための解除コマンド。他の書き込みより先に送る */
export function buildUnlockCommand() {
  return new Uint8Array([OP_UNLOCK, 0xee, 0xfc]);
}

function le16(value) {
  const v = Math.max(0, Math.min(65535, Math.round(value)));
  return [v & 0xff, (v >> 8) & 0xff];
}

/**
 * シミュレーションモードの前提条件を設定する（接続時に1回送る）。
 *
 * @param {number} weightKg ライダー + バイクの総重量
 * @param {number} crr      転がり抵抗係数
 * @param {number} cwr      空気抵抗係数
 */
export function buildSimModeCommand(weightKg = 80, crr = 0.004, cwr = 0.51) {
  return new Uint8Array([
    OP_SET_SIM_MODE,
    ...le16(weightKg * 100),
    ...le16(crr * 1000),
    ...le16(cwr * 1000),
  ]);
}

/**
 * 勾配を設定する。これが坂道でペダルが重くなる本体。
 *
 * Wahoo の仕様では勾配を -1.0〜+1.0 の比率で渡し、
 * (grade + 1.0) × 65535 ÷ 2 を 16bit リトルエンディアンで送る。
 * 勾配0% がちょうど中央値 32768 になる。
 *
 * @param {number} gradePercent 勾配[%]
 */
export function buildSimGradeCommand(gradePercent) {
  // 実在しない急勾配を送らないよう安全側に丸める。
  // 想定外の値で負荷が跳ね上がるのを防ぐため、ここでも二重に制限する。
  const clamped = Math.max(-25, Math.min(25, gradePercent));
  const fraction = clamped / 100;
  return new Uint8Array([
    OP_SET_SIM_GRADE,
    ...le16(((fraction + 1.0) * 65535) / 2.0),
  ]);
}

/** 風速[m/s]を設定する */
export function buildSimWindCommand(windSpeedMs = 0) {
  const clamped = Math.max(-32.767, Math.min(32.767, windSpeedMs));
  return new Uint8Array([OP_SET_SIM_WIND, ...le16((clamped + 32.767) * 1000)]);
}

/** ERG モード（目標パワー固定）。将来のワークアウト機能用 */
export function buildErgCommand(watts) {
  return new Uint8Array([OP_SET_ERG_MODE, ...le16(watts)]);
}

/** 抵抗を 0.0〜1.0 の比率で直接指定する */
export function buildResistanceCommand(ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  return new Uint8Array([OP_SET_RESISTANCE_MODE, ...le16((1 - r) * 16383)]);
}

/** 段階式の抵抗レベル指定 */
export function buildStandardModeCommand(level) {
  return new Uint8Array([OP_SET_STANDARD_MODE, Math.max(0, Math.min(255, level))]);
}
