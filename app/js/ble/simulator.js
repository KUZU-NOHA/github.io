/**
 * シミュレーター — 機材が無くても全機能を動かすための擬似データ源。
 *
 * FtmsTrainer と同じインターフェース（EventTarget + 'data' イベント、
 * connect / disconnect / setGrade）を実装しているため、走行エンジンからは
 * 実機と区別せずに扱える。
 *
 * 要件定義書 5.7 に基づき「あれば便利」ではなく必須機能として実装している：
 *  - 開発時に毎回トレーナーに乗らずに済む
 *  - 自動テストで走行ロジックを検証できる
 *  - 不具合が BLE 起因かアプリロジック起因かを切り分けられる
 */

import { speedFromPower } from '../ride/physics.js';

const TICK_MS = 250;

export class SimulatedTrainer extends EventTarget {
  /**
   * @param {object} opts
   * @param {number} opts.targetPowerW  巡航パワー[W]
   * @param {number} opts.riderWeightKg ライダー+バイク重量[kg]
   */
  constructor({ targetPowerW = 150, riderWeightKg = 80 } = {}) {
    super();
    this.name = 'シミュレーター';
    this.connected = false;
    this.targetPowerW = targetPowerW;
    this.riderWeightKg = riderWeightKg;
    this.grade = 0;
    this._timer = null;
    this._phase = 0;
    this._speedKmh = 0;
  }

  get isSimulated() {
    return true;
  }

  get supportsGrade() {
    return true;
  }

  async connect() {
    if (this.connected) return this;
    this.connected = true;
    this._phase = 0;
    this._speedKmh = 0;
    this._timer = setInterval(() => this._tick(), TICK_MS);
    this.dispatchEvent(new CustomEvent('connected'));
    return this;
  }

  /** 出力を外から動かせるようにしておく（UI のスライダー用） */
  setTargetPower(watts) {
    this.targetPowerW = Math.max(0, watts);
  }

  async setGrade(gradePercent) {
    this.grade = gradePercent;
    return true;
  }

  async pause() {}
  async resume() {}

  async disconnect() {
    this.connected = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.dispatchEvent(new CustomEvent('disconnected'));
  }

  _tick() {
    this._phase += TICK_MS / 1000;

    // 人間のペダリングらしく、ゆっくりした波と細かい揺らぎを重ねる
    const wave = Math.sin(this._phase / 12) * 0.12 + Math.sin(this._phase / 3.3) * 0.05;
    const jitter = (Math.random() - 0.5) * 0.06;
    const powerW = Math.max(0, this.targetPowerW * (1 + wave + jitter));

    // パワーと勾配から釣り合い速度を求め、そこへ滑らかに近づける。
    // 坂を上ると自然に減速し、下ると加速する挙動になる。
    const target = this._equilibriumSpeedKmh(powerW, this.grade);
    this._speedKmh += (target - this._speedKmh) * 0.12;

    const cadenceRpm = this._speedKmh > 1 ? 62 + this._speedKmh * 1.35 + jitter * 40 : 0;
    const heartRateBpm = 95 + (powerW / 300) * 70 + Math.sin(this._phase / 7) * 4;

    this.dispatchEvent(
      new CustomEvent('data', {
        detail: {
          speedKmh: Math.max(0, this._speedKmh),
          cadenceRpm: Math.max(0, cadenceRpm),
          powerW: Math.round(powerW),
          heartRateBpm: Math.round(heartRateBpm),
        },
      })
    );
  }

  /**
   * 与えられたパワーと勾配で釣り合う速度[km/h]を求める。
   * 転がり抵抗・重力・空気抵抗の合計が駆動力と等しくなる点を二分探索する。
   */
  _equilibriumSpeedKmh(powerW, gradePercent) {
    return speedFromPower(powerW, gradePercent, this.riderWeightKg);
  }
}
