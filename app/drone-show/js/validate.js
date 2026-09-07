// 安全検証（要件定義書 F-201〜F-203 に対応）。
//
// シミュレーション段階でここを通っていない振り付けは、実機へアップロード
// してはならない。機体同士の空中衝突は機体損壊だけでなく、地上の人への
// 落下物リスクに直結するため。
//
// 全キーフレーム間を一定間隔でサンプリングし、以下を総当たりで検査する。
//   1. 機体間距離   2. 速度   3. 加速度   4. 最高高度
//   5. 地表クリアランス   6. 水平ジオフェンス   7. 飛行時間 vs バッテリ

import { sampleAt } from './show.js';

export const CHECK_LABELS = {
  separation: '機体間距離',
  speed: '最大速度',
  accel: '最大加速度',
  altitude: '最高高度',
  ground: '地表クリアランス',
  geofence: '水平ジオフェンス',
  duration: '飛行時間 / バッテリ',
};

function fmt(v, digits = 2) {
  return Number(v).toFixed(digits);
}

/**
 * 検証を実行する。サンプル数が多いと重いので、チャンク分割して
 * 進捗を返しながら非同期に処理する（UI を固めないため）。
 *
 * @param {object} compiled compileShow() の結果
 * @param {object} opts {sampleFps, onProgress, signal}
 * @returns {Promise<object>} 検証結果
 */
export async function validateShow(compiled, opts = {}) {
  const { show, timeline } = compiled;
  const n = show.droneCount;
  const lim = show.limits;
  const fps = opts.sampleFps ?? 10;
  const dt = 1 / fps;
  const steps = Math.max(2, Math.ceil(timeline.duration * fps) + 1);

  // 直近 3 サンプルを保持して速度・加速度を差分で求める
  let prev2 = null;
  let prev1 = null;
  const buf = { pos: new Array(n), col: new Array(n) };

  const worst = {
    separation: { value: Infinity, t: 0, a: -1, b: -1 },
    speed: { value: 0, t: 0, drone: -1 },
    accel: { value: 0, t: 0, drone: -1 },
    altitude: { value: -Infinity, t: 0, drone: -1 },
    ground: { value: Infinity, t: 0, drone: -1 },
    geofence: { value: 0, t: 0, drone: -1 },
  };

  // 離着陸中（先頭・末尾のキーフレーム周辺）は地上付近を通るのが正常なので
  // 「飛行中の最低高度」チェックの対象から外す。
  const firstTransEnd = timeline.segs.find((s) => s.kind === 'trans')?.t1 ?? 0;
  const lastTransStart =
    [...timeline.segs].reverse().find((s) => s.kind === 'trans')?.t0 ?? timeline.duration;

  const chunk = Math.max(1, Math.floor(steps / 40));

  for (let step = 0; step < steps; step++) {
    const t = Math.min(timeline.duration, step * dt);
    const { pos } = sampleAt(compiled, t, buf);
    // sampleAt は buf を再利用するため、履歴用にコピーを取る
    const snapshot = pos.map((p) => ({ x: p.x, y: p.y, z: p.z }));

    // --- 機体間距離（全ペア） ---
    for (let i = 0; i < n; i++) {
      const a = snapshot[i];
      for (let j = i + 1; j < n; j++) {
        const b = snapshot[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < worst.separation.value) {
          worst.separation.value = d2;
          worst.separation.t = t;
          worst.separation.a = i;
          worst.separation.b = j;
        }
      }
    }

    // --- 高度・ジオフェンス ---
    for (let i = 0; i < n; i++) {
      const p = snapshot[i];
      if (p.z > worst.altitude.value) {
        worst.altitude.value = p.z;
        worst.altitude.t = t;
        worst.altitude.drone = i;
      }
      const inFlight = t > firstTransEnd && t < lastTransStart;
      if (inFlight && p.z < worst.ground.value) {
        worst.ground.value = p.z;
        worst.ground.t = t;
        worst.ground.drone = i;
      }
      const horiz = Math.hypot(p.x, p.y);
      if (horiz > worst.geofence.value) {
        worst.geofence.value = horiz;
        worst.geofence.t = t;
        worst.geofence.drone = i;
      }
    }

    // --- 速度・加速度 ---
    if (prev1) {
      for (let i = 0; i < n; i++) {
        const v = Math.hypot(
          snapshot[i].x - prev1[i].x,
          snapshot[i].y - prev1[i].y,
          snapshot[i].z - prev1[i].z,
        ) / dt;
        if (v > worst.speed.value) {
          worst.speed.value = v;
          worst.speed.t = t;
          worst.speed.drone = i;
        }
      }
    }
    if (prev2 && prev1) {
      for (let i = 0; i < n; i++) {
        const ax = (snapshot[i].x - 2 * prev1[i].x + prev2[i].x) / (dt * dt);
        const ay = (snapshot[i].y - 2 * prev1[i].y + prev2[i].y) / (dt * dt);
        const az = (snapshot[i].z - 2 * prev1[i].z + prev2[i].z) / (dt * dt);
        const acc = Math.hypot(ax, ay, az);
        if (acc > worst.accel.value) {
          worst.accel.value = acc;
          worst.accel.t = t;
          worst.accel.drone = i;
        }
      }
    }

    prev2 = prev1;
    prev1 = snapshot;

    if (step % chunk === 0) {
      opts.onProgress?.(step / steps);
      // イベントループへ制御を返して UI の固まりを防ぐ
      await new Promise((r) => setTimeout(r, 0));
      if (opts.signal?.aborted) throw new Error('検証を中断しました');
    }
  }
  opts.onProgress?.(1);

  const minDist = Math.sqrt(worst.separation.value);
  const flightMinutes = timeline.duration / 60;
  const batteryLimit = lim.batteryMinutes;

  const checks = [
    {
      id: 'separation',
      ok: minDist >= lim.safetyDistance,
      value: minDist,
      detail:
        worst.separation.a < 0
          ? '—'
          : `最小 ${fmt(minDist)} m（基準 ${fmt(lim.safetyDistance)} m）／ ` +
            `t=${fmt(worst.separation.t, 1)}s・機体 #${worst.separation.a + 1} と #${worst.separation.b + 1}`,
    },
    {
      id: 'speed',
      ok: worst.speed.value <= lim.maxSpeed,
      value: worst.speed.value,
      detail: `最大 ${fmt(worst.speed.value)} m/s（上限 ${fmt(lim.maxSpeed)} m/s）／ ` +
        `t=${fmt(worst.speed.t, 1)}s・機体 #${worst.speed.drone + 1}`,
    },
    {
      id: 'accel',
      ok: worst.accel.value <= lim.maxAccel,
      value: worst.accel.value,
      detail: `最大 ${fmt(worst.accel.value)} m/s²（上限 ${fmt(lim.maxAccel)} m/s²）／ ` +
        `t=${fmt(worst.accel.t, 1)}s・機体 #${worst.accel.drone + 1}`,
    },
    {
      id: 'altitude',
      ok: worst.altitude.value <= lim.maxAltitude,
      value: worst.altitude.value,
      detail: `最高 ${fmt(worst.altitude.value, 1)} m（上限 ${fmt(lim.maxAltitude, 0)} m）`,
    },
    {
      id: 'ground',
      ok: worst.ground.value === Infinity || worst.ground.value >= lim.minFlightAltitude,
      value: worst.ground.value === Infinity ? null : worst.ground.value,
      detail:
        worst.ground.value === Infinity
          ? '飛行区間なし'
          : `飛行中の最低 ${fmt(worst.ground.value, 1)} m（下限 ${fmt(lim.minFlightAltitude, 0)} m）／ ` +
            `t=${fmt(worst.ground.t, 1)}s`,
    },
    {
      id: 'geofence',
      ok: worst.geofence.value <= lim.geofenceRadius,
      value: worst.geofence.value,
      detail: `最大水平距離 ${fmt(worst.geofence.value, 1)} m（上限 ${fmt(lim.geofenceRadius, 0)} m）`,
    },
    {
      id: 'duration',
      ok: flightMinutes <= batteryLimit,
      value: flightMinutes,
      detail: `ショー長 ${fmt(flightMinutes, 1)} 分（バッテリ想定 ${fmt(batteryLimit, 1)} 分）`,
    },
  ].map((c) => ({ ...c, label: CHECK_LABELS[c.id] }));

  return {
    checks,
    passed: checks.every((c) => c.ok),
    minDistance: minDist,
    duration: timeline.duration,
    sampleFps: fps,
    sampleCount: steps,
    checkedAt: new Date().toISOString(),
  };
}
