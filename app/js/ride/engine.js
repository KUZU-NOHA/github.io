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
   * @param {object|null} opts.ghost      比較対象の過去走行（{distanceLog} を持つセッション）。
   *   loop ルートでは距離が周回のたびに巻き戻り単調増加でなくなるため、
   *   ゴースト比較は非 loop ルートに限定する
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
    ghost = null,
  }) {
    super();
    this.path = path;
    this.elevations = elevations;
    this.source = source;
    this.age = age;
    this.speedMultiplier = speedMultiplier;
    this.gradeEnabled = gradeEnabled;
    this.loop = loop;
    this.ghost = !loop && ghost?.distanceLog?.length > 1 ? ghost : null;

    this.state = RideState.IDLE;
    this.distanceM = 0;
    this.elapsedSec = 0;
    this.grade = 0;
    this.position = pointAt(path, 0);
    this.smoothHeading = this.position.heading;

    // 一定距離ごとに (距離, 経過時間) を記録する。次回同じルートを
    // 走ったときのゴーストとして使う。間隔を空けて保存量を抑える。
    this.distanceLog = [{ distanceM: 0, elapsedSec: 0 }];
    this._logIntervalM = 25;
    this.ghostDeltaSec = null; // 正=ゴーストより遅れている、負=先行

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

    // 完走前に途中終了した場合、直近の記録から次のログ間隔(25m)未満
    // しか進んでいないと、最終地点が distanceLog に載らないまま終わる。
    // これでは次回このルートを走ったときにゴーストとして使えない
    // （distanceLog.length > 1 を満たさない）ため、終了時点を必ず確定させる。
    const last = this.distanceLog[this.distanceLog.length - 1];
    if (last.distanceM < this.distanceM) {
      this.distanceLog.push({ distanceM: this.distanceM, elapsedSec: this.elapsedSec });
    }

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

    // 距離ログとゴースト比較
    const lastLogged = this.distanceLog[this.distanceLog.length - 1];
    if (this.distanceM - lastLogged.distanceM >= this._logIntervalM || this.distanceM >= total) {
      this.distanceLog.push({ distanceM: this.distanceM, elapsedSec: this.elapsedSec });
    }
    if (this.ghost) {
      const ghostElapsed = interpolateElapsedAt(this.ghost.distanceLog, this.distanceM);
      this.ghostDeltaSec = ghostElapsed === null ? null : this.elapsedSec - ghostElapsed;
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
      ghostDeltaSec: this.ghostDeltaSec,
      hasGhost: !!this.ghost,
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
      // loop 走行では距離が周回のたびに巻き戻るため、次回のゴーストとして
      // 使うと誤った比較になる。loop の場合は保存しない
      distanceLog: this.loop ? [] : this.distanceLog,
    };
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * 距離ログから、指定距離地点での経過時間を線形補間で求める。
 * ログは距離について単調増加である前提（loop ルートでは呼ばない）。
 */
function interpolateElapsedAt(log, distanceM) {
  if (!log || log.length === 0) return null;
  if (distanceM <= log[0].distanceM) return log[0].elapsedSec;
  const lastPoint = log[log.length - 1];
  if (distanceM >= lastPoint.distanceM) return lastPoint.elapsedSec;

  let lo = 0;
  let hi = log.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (log[mid].distanceM <= distanceM) lo = mid;
    else hi = mid;
  }
  const a = log[lo];
  const b = log[hi];
  const span = b.distanceM - a.distanceM;
  const t = span > 0 ? (distanceM - a.distanceM) / span : 0;
  return a.elapsedSec + (b.elapsedSec - a.elapsedSec) * t;
}
