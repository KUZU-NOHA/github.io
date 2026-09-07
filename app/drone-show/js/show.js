// ショーのデータモデルと軌道サンプリング。
//
// ショーは「キーフレーム（＝隊列）の列」で表現する。各キーフレームは
//   hold       : その隊列で静止している秒数
//   transition : 次の隊列へ移り変わる秒数（最終キーフレームでは未使用）
// を持ち、時間軸は hold → transition → hold → transition → … と並ぶ。
//
// 実機は「事前計算した軌道を GPS 時刻同期で自律再生する」方式のため、
// ここで計算した時刻付きの位置・色がそのまま出力データになる。

import { generate } from './formations.js';
import { assignTargets } from './assign.js';

export const EASINGS = {
  smooth: { label: 'スムーズ（推奨）', fn: (u) => u * u * (3 - 2 * u) },
  smoother: { label: 'よりスムーズ', fn: (u) => u * u * u * (u * (u * 6 - 15) + 10) },
  linear: { label: '等速', fn: (u) => u },
};

export const COLOR_MODES = {
  solid: { label: '単色', colors: 1 },
  gradient: { label: 'グラデーション（高度）', colors: 2 },
  alternate: { label: '交互', colors: 2 },
  rainbow: { label: 'レインボー（機体順）', colors: 0 },
  radial: { label: 'レインボー（放射状）', colors: 0 },
};

// --- 色ユーティリティ -------------------------------------------------------

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { r: 255, g: 255, b: 255 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

export function rgbToHex({ r, g, b }) {
  const h = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

// --- キーフレーム -----------------------------------------------------------

export function makeKeyframe(overrides = {}) {
  return {
    name: '新しい隊列',
    type: 'circle',
    params: {},
    hold: 5,
    transition: 8,
    easing: 'smooth',
    colorMode: 'solid',
    colorA: '#00d4ff',
    colorB: '#ff2d95',
    ...overrides,
  };
}

/**
 * 既定のショー。地上グリッド → 垂直上昇 → 各種隊列 → 着陸、という
 * 実運用で標準的な流れをそのまま雛形にしている。
 * 離陸直後に真上へ上がるキーフレームを挟むのは、密なグリッドから
 * いきなり散開させると軌道が交差して衝突リスクが高くなるため。
 */
export function defaultShow() {
  return {
    name: 'サンプルショー',
    droneCount: 50,
    limits: {
      safetyDistance: 2.5,
      maxSpeed: 6,
      maxAccel: 4,
      maxAltitude: 100,
      minFlightAltitude: 10,
      geofenceRadius: 90,
      batteryMinutes: 12,
    },
    exportFps: 10,
    keyframes: [
      makeKeyframe({
        name: '離陸グリッド',
        type: 'grid',
        params: { cols: 10, spacing: 4, z: 0 },
        hold: 3, transition: 10, colorMode: 'solid', colorA: '#ffffff',
      }),
      makeKeyframe({
        name: '上昇（真上へ）',
        type: 'grid',
        params: { cols: 10, spacing: 4, z: 25 },
        hold: 2, transition: 17, colorMode: 'gradient', colorA: '#00d4ff', colorB: '#0044ff',
      }),
      makeKeyframe({
        name: 'リング',
        type: 'ringVertical',
        params: { radius: 32, z: 55 },
        hold: 5, transition: 11, colorMode: 'rainbow',
      }),
      makeKeyframe({
        name: 'テキスト',
        type: 'text',
        params: { text: 'HELLO', cellSize: 4.5, z: 35 },
        hold: 7, transition: 12, colorMode: 'solid', colorA: '#ffd400',
      }),
      makeKeyframe({
        name: 'ハート',
        type: 'heart',
        params: { scale: 72, z: 52 },
        hold: 6, transition: 11, colorMode: 'solid', colorA: '#ff2d95',
      }),
      makeKeyframe({
        name: '球',
        type: 'sphere',
        params: { radius: 30, z: 55 },
        hold: 5, transition: 17, colorMode: 'radial',
      }),
      makeKeyframe({
        name: '着陸前ホバリング',
        type: 'grid',
        params: { cols: 10, spacing: 4, z: 25 },
        hold: 3, transition: 10, colorMode: 'solid', colorA: '#00d4ff',
      }),
      makeKeyframe({
        name: '着陸',
        type: 'grid',
        params: { cols: 10, spacing: 4, z: 0 },
        hold: 3, transition: 5, colorMode: 'solid', colorA: '#ffffff',
      }),
    ],
  };
}

// --- 隊列の解決（割当込み） -------------------------------------------------

/**
 * 各キーフレームについて「機体 i が居るべき座標」を確定させる。
 * 先頭キーフレームは生成順そのまま、以降は直前の位置からの
 * 総移動距離が最小になるようハンガリアン法で割り当てる。
 */
export function resolvePositions(show) {
  const n = show.droneCount;
  const out = [];
  for (let k = 0; k < show.keyframes.length; k++) {
    const kf = show.keyframes[k];
    const raw = generate(kf.type, n, kf.params);
    if (k === 0) {
      out.push(raw);
      continue;
    }
    const assign = assignTargets(out[k - 1], raw);
    const placed = new Array(n);
    for (let i = 0; i < n; i++) placed[i] = raw[assign[i]];
    out.push(placed);
  }
  return out;
}

/** キーフレームごとの機体色（0-255 の {r,g,b}）を求める。 */
export function resolveColors(show, positions) {
  const n = show.droneCount;
  return show.keyframes.map((kf, k) => {
    const pos = positions[k];
    const a = hexToRgb(kf.colorA);
    const b = hexToRgb(kf.colorB);
    const zs = pos.map((p) => p.z);
    const zMin = Math.min(...zs);
    const zMax = Math.max(...zs);
    const zSpan = zMax - zMin || 1;

    const cols = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = pos[i];
      switch (kf.colorMode) {
        case 'gradient': {
          const u = (p.z - zMin) / zSpan;
          cols[i] = {
            r: a.r + (b.r - a.r) * u,
            g: a.g + (b.g - a.g) * u,
            b: a.b + (b.b - a.b) * u,
          };
          break;
        }
        case 'alternate':
          cols[i] = i % 2 === 0 ? { ...a } : { ...b };
          break;
        case 'rainbow':
          cols[i] = hsvToRgb((i / n) % 1, 0.85, 1);
          break;
        case 'radial': {
          const ang = Math.atan2(p.y, p.x);
          cols[i] = hsvToRgb((ang / (Math.PI * 2) + 1) % 1, 0.85, 1);
          break;
        }
        default:
          cols[i] = { ...a };
      }
    }
    return cols;
  });
}

// --- タイムライン -----------------------------------------------------------

/** キーフレーム列から時間区間（hold / trans）を組み立てる。 */
export function buildTimeline(show) {
  const segs = [];
  let t = 0;
  const kfs = show.keyframes;
  for (let k = 0; k < kfs.length; k++) {
    const hold = Math.max(0, kfs[k].hold);
    segs.push({ kind: 'hold', k, t0: t, t1: t + hold });
    t += hold;
    if (k < kfs.length - 1) {
      const tr = Math.max(0.1, kfs[k].transition);
      segs.push({ kind: 'trans', k, t0: t, t1: t + tr });
      t += tr;
    }
  }
  return { segs, duration: t };
}

/**
 * 事前計算済みのショー。UI・検証・書き出しはすべてこれを参照する。
 */
export function compileShow(show) {
  const positions = resolvePositions(show);
  const colors = resolveColors(show, positions);
  const timeline = buildTimeline(show);
  return { show, positions, colors, timeline };
}

/**
 * 時刻 t におけるの全機の位置と色を求め、out に書き込む（配列を再利用する）。
 * @returns {{pos: Array, col: Array}}
 */
export function sampleAt(compiled, t, out) {
  const { show, positions, colors, timeline } = compiled;
  const n = show.droneCount;
  const pos = out?.pos ?? new Array(n);
  const col = out?.col ?? new Array(n);
  // 使い回しのバッファが前回の機数のままだと、機数を減らしたときに
  // 消えたはずの機体が残って描画・書き出しされる
  if (pos.length !== n) pos.length = n;
  if (col.length !== n) col.length = n;
  for (let i = 0; i < n; i++) {
    if (!pos[i]) pos[i] = { x: 0, y: 0, z: 0 };
    if (!col[i]) col[i] = { r: 0, g: 0, b: 0 };
  }

  const clamped = Math.max(0, Math.min(timeline.duration, t));
  let seg = timeline.segs[timeline.segs.length - 1];
  for (const s of timeline.segs) {
    if (clamped <= s.t1) { seg = s; break; }
  }

  if (seg.kind === 'hold') {
    const P = positions[seg.k];
    const C = colors[seg.k];
    for (let i = 0; i < n; i++) {
      pos[i].x = P[i].x; pos[i].y = P[i].y; pos[i].z = P[i].z;
      col[i].r = C[i].r; col[i].g = C[i].g; col[i].b = C[i].b;
    }
    return { pos, col };
  }

  const kf = show.keyframes[seg.k];
  const span = seg.t1 - seg.t0 || 1;
  const raw = (clamped - seg.t0) / span;
  const ease = (EASINGS[kf.easing] || EASINGS.smooth).fn;
  const u = ease(Math.max(0, Math.min(1, raw)));
  const P0 = positions[seg.k];
  const P1 = positions[seg.k + 1];
  const C0 = colors[seg.k];
  const C1 = colors[seg.k + 1];
  for (let i = 0; i < n; i++) {
    pos[i].x = P0[i].x + (P1[i].x - P0[i].x) * u;
    pos[i].y = P0[i].y + (P1[i].y - P0[i].y) * u;
    pos[i].z = P0[i].z + (P1[i].z - P0[i].z) * u;
    // 色は時間に対して線形に混ぜる（イージングを掛けると点滅が不自然になる）
    col[i].r = C0[i].r + (C1[i].r - C0[i].r) * raw;
    col[i].g = C0[i].g + (C1[i].g - C0[i].g) * raw;
    col[i].b = C0[i].b + (C1[i].b - C0[i].b) * raw;
  }
  return { pos, col };
}

/** 現在時刻がどのキーフレーム区間かを返す（UI のハイライト用）。 */
export function segmentAt(compiled, t) {
  const clamped = Math.max(0, Math.min(compiled.timeline.duration, t));
  for (const s of compiled.timeline.segs) {
    if (clamped <= s.t1) return s;
  }
  return compiled.timeline.segs[compiled.timeline.segs.length - 1];
}
