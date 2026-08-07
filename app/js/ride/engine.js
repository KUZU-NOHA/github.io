/**
 * 走行エンジン — アプリの心臓部。
 *
 * データ源（実機トレーナー or シミュレーター）から速度を受け取り、
 *   1. 走行距離を積算する
 *   2. 経路上の現在位置・進行方位を求める
 *   3. 標高プロファイルから勾配を求め、トレーナーへ送り返す
 *   4. 消費カロリー・心拍ゾーン滞在時間を積算する
 * を毎フレーム行い、'tick' イベントで状態を配信する。
 *
 * 描画・UI には一切依存しない（テスト可能に保つため）。
 */

import { pointAt, gradeAt, elevationAt, lerpAngle } from '../map/geo.js';
import { CalorieAccumulator, zoneFor, HEART_RATE_ZONES } from './calories.js';

export const RideState = {
  IDLE: 'idle',
  RIDING: 'riding',
  PAUSED: 'paused',
  FINISHED: 'finished',
};

export class RideEngine extends EventTarget {
  /**
   * @param {object} opts
   * @param {object} opts.path        buildPath() の戻り値
   * @param {number[]} opts.elevations 経路各点の標高[m]
   * @param {object} opts.source      トレーナー or シミュレーター
   * @param {number} opts.weightKg
   * @param {number} opts.age
   * @param {number} opts.speedMultiplier 映像速度の倍率（F-303）
   * @param {boolean} opts.gradeEnabled   勾配連動の ON/OFF
   * @param {boolean} opts.loop           終点到達後に始点へ戻るか
   */
  constructor({
    path,
    elevations = [],
    source,
    weightKg = 70,
    age = 40,
    speedMultiplier = 1,
    gradeEnabled = true,
    loop = false,
  }) {
    super();
    this.path = path;
    this.elevations = elevations;
    this.source = source;
    this.age = age;
    this.speedMultiplier = speedMultiplier;
    this.gradeEnabled = gradeEnabled;
    this.loop = loop;

    this.state = RideState.IDLE;
    this.distanceM = 0;
    this.elapsedSec = 0;
    this.grade = 0;
    this.position = pointAt(path, 0);
    this.smoothHeading = this.position.heading;

    this.live = { speedKmh: 0, cadenceRpm: 0, powerW: 0, heartRateBpm: 0 };
    this.calories = new CalorieAccumulator({ weightKg });

    this.maxSpeedKmh = 0;
    this.maxPowerW = 0;
    this._powerSum = 0;
    this._powerCount = 0;
    this._hrSum = 0;
    this._hrCount = 0;
    this.zoneSeconds = Object.fromEntries(HEART_RATE_ZONES.map((z) => [z.key, 0]));

    this._lastTickAt = 0;
    this._rafId = null;
    this._onData = (e) => this._handleData(e.detail);
    this.startedAt = null;
  }

  get progress() {
    return this.path.totalDistanceM > 0
      ? Math.min(1, this.distanceM / this.path.totalDistanceM)
      : 0;
  }

  /**
   * 実際に画面へ出す速度。映像速度の倍率を掛けた「仮想速度」。
   * 距離もこの速度で積算するため、速度計・景色・走行距離が全て一致する。
   */
  get effectiveSpeedKmh() {
    return this.live.speedKmh * this.speedMultiplier;
  }

  get isRiding() {
    return this.state === RideState.RIDING;
  }

  start() {
    if (this.state === RideState.RIDING) return;
    if (this.state === RideState.IDLE) {
      this.startedAt = new Date();
    }
    this.state = RideState.RIDING;
    this.source.addEventListener('data', this._onData);
    this.source.resume?.();
    this._lastTickAt = performance.now();
    this._loop();
    this.dispatchEvent(new CustomEvent('statechange', { detail: this.state }));
  }

  pause() {
    if (this.state !== RideState.RIDING) return;
    this.state = RideState.PAUSED;
    this._stopLoop();
    this.source.pause?.();
    this.live.speedKmh = 0;
    this.dispatchEvent(new CustomEvent('statechange', { detail: this.state }));
  }

  finish() {
    this.state = RideState.FINISHED;
    this._stopLoop();
    this.source.pause?.();
    this.dispatchEvent(new CustomEvent('statechange', { detail: this.state }));
    this.dispatchEvent(new CustomEvent('finish', { detail: this.summary() }));
  }

  _stopLoop() {
    this.source.removeEventListener('data', this._onData);
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _handleData(d) {
    if (Number.isFinite(d.speedKmh)) this.live.speedKmh = d.speedKmh;
    if (Number.isFinite(d.cadenceRpm)) this.live.cadenceRpm = d.cadenceRpm;
    if (Number.isFinite(d.powerW)) this.live.powerW = d.powerW;
    if (Number.isFinite(d.heartRateBpm)) this.live.heartRateBpm = d.heartRateBpm;
  }

  _loop() {
    const step = () => {
      if (this.state !== RideState.RIDING) return;
      const now = performance.now();
      const dt = Math.min((now - this._lastTickAt) / 1000, 1); // タブ復帰時の巨大 dt を抑える
      this._lastTickAt = now;
      this.advance(dt);
      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }

  /**
   * 1ステップ進める。テストから直接呼べるよう requestAnimationFrame から分離している。
   * @param {number} dtSec
   */
  advance(dtSec) {
    if (dtSec <= 0) return;
    this.elapsedSec += dtSec;

    // 距離の積算（映像速度の倍率を掛ける）。
    // 表示速度にも同じ倍率を掛けるので、速度計と景色の進みが一致する。
    const metersPerSec = (this.effectiveSpeedKmh / 3.6);
    this.distanceM += metersPerSec * dtSec;

    const total = this.path.totalDistanceM;
    if (this.distanceM >= total) {
      if (this.loop) {
        this.distanceM = this.distanceM % total;
      } else {
        this.distanceM = total;
      }
    }

    // 位置と方位。方位は急に振れるとカメラが酔うので補間でならす
    this.position = pointAt(this.path, this.distanceM);
    this.smoothHeading = lerpAngle(
      this.smoothHeading,
      this.position.heading,
      Math.min(1, dtSec * 2.5)
    );
    this.altitude = elevationAt(this.path, this.elevations, this.distanceM);

    // 勾配とトレーナーへの反映
    this.grade = gradeAt(this.path, this.elevations, this.distanceM);
    if (this.gradeEnabled && this.source.supportsGrade) {
      this.source.setGrade(this.grade);
    }

    // 消費カロリー
    this.calories.add(this.live, dtSec);

    // 最大値は「値を消費するここ」で採る。心拍計など data イベントを
    // 経由せず live に直接書き込む経路があるため、_handleData では漏れる。
    // 速度は表示・距離と揃えるため倍率を掛けた値で記録する。
    this.maxSpeedKmh = Math.max(this.maxSpeedKmh, this.effectiveSpeedKmh);
    this.maxPowerW = Math.max(this.maxPowerW, this.live.powerW);

    // 平均値の材料
    if (this.live.powerW > 0) {
      this._powerSum += this.live.powerW * dtSec;
      this._powerCount += dtSec;
    }
    if (this.live.heartRateBpm > 0) {
      this._hrSum += this.live.heartRateBpm * dtSec;
      this._hrCount += dtSec;
      const zone = zoneFor(this.live.heartRateBpm, this.age);
      if (zone) this.zoneSeconds[zone.key] += dtSec;
    }

    this.dispatchEvent(new CustomEvent('tick', { detail: this.snapshot() }));

    if (!this.loop && this.distanceM >= total) {
      this.finish();
    }
  }

  get avgPowerW() {
    return this._powerCount > 0 ? this._powerSum / this._powerCount : 0;
  }

  get avgHeartRateBpm() {
    return this._hrCount > 0 ? this._hrSum / this._hrCount : 0;
  }

  get avgSpeedKmh() {
    return this.elapsedSec > 0 ? (this.distanceM / this.elapsedSec) * 3.6 : 0;
  }

  snapshot() {
    return {
      state: this.state,
      distanceM: this.distanceM,
      elapsedSec: this.elapsedSec,
      progress: this.progress,
      grade: this.grade,
      altitude: this.altitude ?? 0,
      position: this.position,
      heading: this.smoothHeading,
      speedKmh: this.effectiveSpeedKmh,
      // 倍率を掛ける前の実測速度。倍率を使っているか判別する用
      rawSpeedKmh: this.live.speedKmh,
      speedMultiplier: this.speedMultiplier,
      cadenceRpm: this.live.cadenceRpm,
      powerW: this.live.powerW,
      heartRateBpm: this.live.heartRateBpm,
      kcal: this.calories.kcal,
      kj: this.calories.kj,
      calorieIsEstimate: this.calories.isEstimate,
    };
  }

  /** 走行終了時に保存する要約 */
  summary() {
    return {
      startedAt: (this.startedAt ?? new Date()).toISOString(),
      distanceM: Math.round(this.distanceM),
      elapsedSec: Math.round(this.elapsedSec),
      kcal: Math.round(this.calories.kcal),
      kj: Math.round(this.calories.kj),
      calorieIsEstimate: this.calories.isEstimate,
      avgSpeedKmh: round1(this.avgSpeedKmh),
      maxSpeedKmh: round1(this.maxSpeedKmh),
      avgPowerW: Math.round(this.avgPowerW),
      maxPowerW: Math.round(this.maxPowerW),
      avgHeartRateBpm: Math.round(this.avgHeartRateBpm),
      zoneSeconds: Object.fromEntries(
        Object.entries(this.zoneSeconds).map(([k, v]) => [k, Math.round(v)])
      ),
    };
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
