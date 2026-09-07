// 飛行経路の書き出し。
//
// 出力は「時刻 × XYZ 座標 × LED 色」を機体ごとに並べたもので、
// 地上局ソフト（Skybrush Server / ArduPilot 系）へ取り込むための中間データ。
// 座標は ENU（x = 東, y = 北, z = 高度）、単位はメートル、原点は離陸グリッド中心。

import { sampleAt } from './show.js';

/** 全機・全時刻を一定 fps でサンプリングして配列に落とす。 */
export function sampleTrajectories(compiled, fps) {
  const { show, timeline } = compiled;
  const n = show.droneCount;
  const dt = 1 / fps;
  const steps = Math.ceil(timeline.duration * fps) + 1;
  const buf = { pos: new Array(n), col: new Array(n) };

  const drones = [];
  for (let i = 0; i < n; i++) drones.push([]);

  for (let s = 0; s < steps; s++) {
    const t = Math.min(timeline.duration, s * dt);
    const { pos, col } = sampleAt(compiled, t, buf);
    for (let i = 0; i < n; i++) {
      drones[i].push([
        round(t, 3),
        round(pos[i].x, 3),
        round(pos[i].y, 3),
        round(pos[i].z, 3),
        Math.round(col[i].r),
        Math.round(col[i].g),
        Math.round(col[i].b),
      ]);
    }
  }
  return { drones, steps, fps, duration: timeline.duration };
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function metaBlock(compiled, sampled, validation) {
  const { show } = compiled;
  return {
    name: show.name,
    generated_at: new Date().toISOString(),
    generator: 'drone-show-designer',
    drone_count: show.droneCount,
    duration_s: round(sampled.duration, 3),
    fps: sampled.fps,
    samples_per_drone: sampled.steps,
    coordinate_system: 'ENU (x=east, y=north, z=up), origin = launch grid center',
    units: { position: 'meter', time: 'second', color: 'sRGB 0-255' },
    limits: show.limits,
    validation: validation
      ? {
          passed: validation.passed,
          checked_at: validation.checkedAt,
          min_separation_m: round(validation.minDistance, 3),
          checks: validation.checks.map((c) => ({ id: c.id, ok: c.ok, detail: c.detail })),
        }
      : null,
  };
}

/** 全機まとめた CSV。1 行 = 1 機体 1 時刻。 */
export function toCsv(compiled, sampled) {
  const lines = ['drone_id,time_s,x_m,y_m,z_m,r,g,b'];
  sampled.drones.forEach((samples, i) => {
    const id = i + 1;
    for (const s of samples) {
      lines.push(`${id},${s[0]},${s[1]},${s[2]},${s[3]},${s[4]},${s[5]},${s[6]}`);
    }
  });
  return lines.join('\n') + '\n';
}

/**
 * 軌道 JSON。サンプルは [t,x,y,z,r,g,b] の配列で持つ。
 * ヘッダ部だけ整形し、サンプル本体は 1 機 1 行に詰める。全体を整形すると
 * ファイルが数倍に膨らむ一方、人が読むのはヘッダだけであるため。
 */
export function toTrajectoryJson(compiled, sampled, validation) {
  const header = {
    format: 'drone-show-trajectory',
    version: 1,
    meta: metaBlock(compiled, sampled, validation),
    sample_fields: ['t_s', 'x_m', 'y_m', 'z_m', 'r', 'g', 'b'],
  };
  const headerText = JSON.stringify(header, null, 2);
  const droneLines = sampled.drones
    .map((samples, i) => `    {"id": ${i + 1}, "samples": ${JSON.stringify(samples)}}`)
    .join(',\n');
  // ヘッダの閉じ括弧を外して drones を継ぎ足す
  return `${headerText.slice(0, -2)},\n  "drones": [\n${droneLines}\n  ]\n}\n`;
}

/** キーフレーム定義そのもの（再編集用のプロジェクトファイル）。 */
export function toProjectJson(show) {
  return JSON.stringify(
    { format: 'drone-show-project', version: 1, show },
    null,
    2,
  );
}

/** 読み込んだプロジェクト JSON を検証して show を取り出す。 */
export function parseProjectJson(text) {
  const data = JSON.parse(text);
  const show = data?.show ?? data;
  if (!show || typeof show !== 'object') throw new Error('ショー定義が見つかりません');
  if (!Array.isArray(show.keyframes) || show.keyframes.length === 0) {
    throw new Error('keyframes が空です');
  }
  if (!Number.isFinite(show.droneCount) || show.droneCount < 1) {
    throw new Error('droneCount が不正です');
  }
  return show;
}

/** 離陸位置一覧（現地で機体を並べるための配置表）。 */
export function toLaunchPositionsCsv(compiled) {
  const first = compiled.positions[0];
  const lines = ['drone_id,x_m,y_m,z_m'];
  first.forEach((p, i) => {
    lines.push(`${i + 1},${round(p.x, 3)},${round(p.y, 3)},${round(p.z, 3)}`);
  });
  return lines.join('\n') + '\n';
}

/** ブラウザにファイルとして保存させる。 */
export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name) {
  return (
    String(name || 'show')
      .trim()
      .replace(/[^\w\-一-龠ぁ-んァ-ヶー]+/g, '_')
      .slice(0, 60) || 'show'
  );
}
