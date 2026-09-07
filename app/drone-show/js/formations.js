// 隊列（フォーメーション）ジェネレータ。
//
// 座標系: ENU（x = 東 [m], y = 北 [m], z = 高度 [m]）。原点は離陸グリッドの中心。
// 観客は -y 方向（南）から見上げる想定のため、文字・ハートなど「絵」として
// 見せたい隊列は XZ 平面（y = 0 の垂直面）に生成する。
//
// 各ジェネレータは必ずちょうど n 点を返す。

import { glyphRows, GLYPH_WIDTH, GLYPH_HEIGHT } from './font5x7.js';

const TAU = Math.PI * 2;

/** 点集合から n 点を均等間隔で抜き出す（m >= n が前提）。 */
function pickEven(points, n) {
  const m = points.length;
  if (m === 0) return [];
  if (m === n) return points.slice();
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = points[Math.min(m - 1, Math.floor((i * m) / n))];
  }
  return out;
}

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function lerpP(a, b, u) {
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    z: a.z + (b.z - a.z) * u,
  };
}

/**
 * 線分の集まり（互いに離れていてもよい）の合計長に対して n 点を等間隔に置く。
 * 立方体の稜線や星の輪郭のように「折れ線が飛び飛び」でも使える。
 */
function distributeAlongSegments(segments, n) {
  const lens = segments.map(([a, b]) => dist(a, b));
  const total = lens.reduce((s, x) => s + x, 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    let target = ((i + 0.5) / n) * total;
    let s = 0;
    while (s < segments.length - 1 && target > lens[s]) {
      target -= lens[s];
      s++;
    }
    const u = lens[s] > 0 ? target / lens[s] : 0;
    out.push(lerpP(segments[s][0], segments[s][1], u));
  }
  return out;
}

/**
 * 曲線を弧長で等間隔に n 分割する。
 *
 * 媒介変数のまま等間隔に取ると、曲線の「進みが遅い」場所（ハートの下端の
 * 尖点など）に機体が密集し、機体間距離の検証に落ちる。実機では接触事故に
 * 直結するため、絵になる曲線は必ずここを通す。
 *
 * @param {Array} dense 十分細かくサンプリングした曲線上の点列
 * @param {number} n 欲しい点数
 * @param {boolean} closed 閉曲線なら true
 */
function resampleByArcLength(dense, n, closed) {
  const pts = closed ? dense.concat([dense[0]]) : dense;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  if (total === 0) return new Array(n).fill(pts[0]);

  const out = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const target = closed
      ? (i / n) * total
      : n === 1 ? 0 : (i / (n - 1)) * total;
    while (j < cum.length - 1 && cum[j] < target) j++;
    const span = cum[j] - cum[j - 1];
    const u = span > 0 ? (target - cum[j - 1]) / span : 0;
    out.push(lerpP(pts[j - 1], pts[j], u));
  }
  return out;
}

const DENSE = 2000;

// --- 各ジェネレータ ---------------------------------------------------------

function grid(n, p) {
  const cols = Math.max(1, Math.round(p.cols));
  const rows = Math.ceil(n / cols);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push({
      x: (c - (cols - 1) / 2) * p.spacing,
      y: ((rows - 1) / 2 - r) * p.spacing,
      z: p.z,
    });
  }
  return out;
}

function line(n, p) {
  const h = (p.heading * Math.PI) / 180;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    out.push({ x: Math.cos(h) * t * p.length, y: Math.sin(h) * t * p.length, z: p.z });
  }
  return out;
}

function circle(n, p) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push({ x: Math.cos(a) * p.radius, y: Math.sin(a) * p.radius, z: p.z });
  }
  return out;
}

function ringVertical(n, p) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push({ x: Math.cos(a) * p.radius, y: 0, z: p.z + Math.sin(a) * p.radius });
  }
  return out;
}

function sphere(n, p) {
  // フィボナッチ球。表面に n 点をほぼ均等に分布させる。
  const out = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const zz = n === 1 ? 0 : 1 - (2 * i) / (n - 1);
    const r = Math.sqrt(Math.max(0, 1 - zz * zz));
    const a = golden * i;
    out.push({
      x: Math.cos(a) * r * p.radius,
      y: Math.sin(a) * r * p.radius,
      z: p.z + zz * p.radius,
    });
  }
  return out;
}

function helix(n, p) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);
    const a = u * TAU * p.turns;
    out.push({
      x: Math.cos(a) * p.radius,
      y: Math.sin(a) * p.radius,
      z: p.z + u * p.height,
    });
  }
  return out;
}

function spiral(n, p) {
  // 水平面の渦巻き（銀河風）。半径が外側ほど広がる。
  // 媒介変数のままでは中心側が密集するため、弧長で等間隔に取り直す。
  const dense = [];
  for (let i = 0; i < DENSE; i++) {
    const u = i / (DENSE - 1);
    const r = p.radius * Math.sqrt(u);
    const a = u * TAU * p.turns;
    dense.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: p.z });
  }
  return resampleByArcLength(dense, n, false);
}

function cube(n, p) {
  // 立方体の 12 稜線の合計長に対して等間隔に配置する。
  const h = p.size / 2;
  const c = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ].map((v) => ({ x: v[0], y: v[1], z: p.z + v[2] }));
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return distributeAlongSegments(edges.map(([a, b]) => [c[a], c[b]]), n);
}

function heart(n, p) {
  // 定番のハート曲線を XZ 平面（垂直面）に描く。
  // 下端の尖点で媒介変数の進みが遅くなるため、弧長で取り直して密集を防ぐ。
  const raw = [];
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < DENSE; i++) {
    const t = (i / DENSE) * TAU;
    const hx = 16 * Math.pow(Math.sin(t), 3);
    const hz =
      13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    zMin = Math.min(zMin, hz);
    zMax = Math.max(zMax, hz);
    raw.push([hx, hz]);
  }
  // この曲線は上下非対称なので、実寸の高さが指定値に一致し、かつ図形の中心が
  // 指定高度に来るよう正規化する。そうしないと「高さ」「中心高度」を指定しても
  // 下端が地面すれすれになるなど、数値と見た目が食い違う。
  const k = p.scale / (zMax - zMin);
  const mid = (zMin + zMax) / 2;
  const dense = raw.map(([hx, hz]) => ({ x: hx * k, y: 0, z: p.z + (hz - mid) * k }));
  return resampleByArcLength(dense, n, true);
}

function star(n, p) {
  const pts = Math.max(3, Math.round(p.points));
  const verts = [];
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 === 0 ? p.outerR : p.innerR;
    const a = (i / (pts * 2)) * TAU + Math.PI / 2;
    verts.push({ x: Math.cos(a) * r, y: 0, z: p.z + Math.sin(a) * r });
  }
  const segs = verts.map((v, i) => [v, verts[(i + 1) % verts.length]]);
  return distributeAlongSegments(segs, n);
}

function text(n, p) {
  const str = String(p.text || '').toUpperCase();
  const chars = str.length ? str.split('') : [' '];

  // まず等倍でセルを列挙し、n に足りなければ 1 セルを upscale^2 に細分して増やす。
  const build = (upscale) => {
    const cells = [];
    let colOffset = 0;
    for (const ch of chars) {
      const rows = glyphRows(ch);
      for (let r = 0; r < GLYPH_HEIGHT; r++) {
        for (let c = 0; c < GLYPH_WIDTH; c++) {
          if (rows[r][c] !== '1') continue;
          for (let sy = 0; sy < upscale; sy++) {
            for (let sx = 0; sx < upscale; sx++) {
              cells.push([
                colOffset + c + (sx + 0.5) / upscale,
                r + (sy + 0.5) / upscale,
              ]);
            }
          }
        }
      }
      colOffset += GLYPH_WIDTH + 1;
    }
    return { cells, width: Math.max(1, colOffset - 1) };
  };

  let upscale = 1;
  let built = build(upscale);
  while (built.cells.length < n && upscale < 6) {
    upscale += 1;
    built = build(upscale);
  }

  // セルを細分したぶんだけ文字を物理的に拡大する。こうすると隣り合う機体の
  // 間隔は常に cellSize のままになり、機数を増やしても安全距離を割らない。
  const chosen = pickEven(built.cells, n);
  const scale = p.cellSize * upscale;
  return chosen.map((c) => ({
    x: (c[0] - built.width / 2) * scale,
    y: 0,
    z: p.z + (GLYPH_HEIGHT - c[1]) * scale,
  }));
}

function wave(n, p) {
  const cols = Math.max(1, Math.round(p.cols));
  const rows = Math.ceil(n / cols);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = (c - (cols - 1) / 2) * p.spacing;
    const y = ((rows - 1) / 2 - r) * p.spacing;
    out.push({ x, y, z: p.z + Math.sin((x / p.wavelength) * TAU) * p.amplitude });
  }
  return out;
}

function scatter(n, p) {
  // 決定論的な疑似乱数（同じ seed なら常に同じ雲になる）。
  let s = Math.round(p.seed) || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const r = p.radius * Math.sqrt(rnd());
    out.push({
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      z: p.z + (rnd() - 0.5) * p.thickness,
    });
  }
  return out;
}

// --- 定義テーブル -----------------------------------------------------------
// params は UI を自動生成するためのスキーマも兼ねる。

export const FORMATIONS = {
  grid: {
    label: 'グリッド（離着陸）',
    hint: '離陸・着陸位置。地上に置く場合は高度 0。',
    gen: grid,
    params: [
      { key: 'cols', label: '列数', min: 1, max: 40, step: 1, def: 10 },
      { key: 'spacing', label: '間隔 [m]', min: 1, max: 20, step: 0.5, def: 4 },
      { key: 'z', label: '高度 [m]', min: 0, max: 150, step: 1, def: 0 },
    ],
  },
  line: {
    label: '直線',
    gen: line,
    params: [
      { key: 'length', label: '全長 [m]', min: 5, max: 300, step: 1, def: 80 },
      { key: 'heading', label: '方位 [°]', min: 0, max: 360, step: 5, def: 0 },
      { key: 'z', label: '高度 [m]', min: 0, max: 150, step: 1, def: 40 },
    ],
  },
  circle: {
    label: '円（水平）',
    gen: circle,
    params: [
      { key: 'radius', label: '半径 [m]', min: 3, max: 150, step: 1, def: 35 },
      { key: 'z', label: '高度 [m]', min: 0, max: 150, step: 1, def: 45 },
    ],
  },
  ringVertical: {
    label: 'リング（垂直）',
    hint: '観客から見て正面を向く輪。',
    gen: ringVertical,
    params: [
      { key: 'radius', label: '半径 [m]', min: 3, max: 100, step: 1, def: 30 },
      { key: 'z', label: '中心高度 [m]', min: 0, max: 150, step: 1, def: 50 },
    ],
  },
  sphere: {
    label: '球',
    gen: sphere,
    params: [
      { key: 'radius', label: '半径 [m]', min: 3, max: 100, step: 1, def: 30 },
      { key: 'z', label: '中心高度 [m]', min: 0, max: 150, step: 1, def: 50 },
    ],
  },
  helix: {
    label: 'らせん',
    gen: helix,
    params: [
      { key: 'radius', label: '半径 [m]', min: 3, max: 100, step: 1, def: 25 },
      { key: 'height', label: '高さ [m]', min: 5, max: 120, step: 1, def: 50 },
      { key: 'turns', label: '回転数', min: 0.5, max: 8, step: 0.5, def: 2 },
      { key: 'z', label: '下端高度 [m]', min: 0, max: 150, step: 1, def: 20 },
    ],
  },
  spiral: {
    label: '渦巻き（水平）',
    gen: spiral,
    params: [
      { key: 'radius', label: '外周半径 [m]', min: 5, max: 150, step: 1, def: 45 },
      { key: 'turns', label: '回転数', min: 0.5, max: 8, step: 0.5, def: 3 },
      { key: 'z', label: '高度 [m]', min: 0, max: 150, step: 1, def: 45 },
    ],
  },
  cube: {
    label: '立方体（稜線）',
    gen: cube,
    params: [
      { key: 'size', label: '一辺 [m]', min: 5, max: 120, step: 1, def: 45 },
      { key: 'z', label: '中心高度 [m]', min: 0, max: 150, step: 1, def: 50 },
    ],
  },
  heart: {
    label: 'ハート',
    gen: heart,
    params: [
      { key: 'scale', label: '高さ [m]', min: 5, max: 120, step: 1, def: 45 },
      { key: 'z', label: '中心高度 [m]', min: 0, max: 150, step: 1, def: 50 },
    ],
  },
  star: {
    label: '星',
    gen: star,
    params: [
      { key: 'outerR', label: '外半径 [m]', min: 5, max: 100, step: 1, def: 35 },
      { key: 'innerR', label: '内半径 [m]', min: 2, max: 100, step: 1, def: 15 },
      { key: 'points', label: '角の数', min: 3, max: 12, step: 1, def: 5 },
      { key: 'z', label: '中心高度 [m]', min: 0, max: 150, step: 1, def: 50 },
    ],
  },
  text: {
    label: 'テキスト',
    hint: '英数字と記号のみ。「1マス」は隣り合う機体の間隔で、機数が多いと文字全体が大きくなる。',
    gen: text,
    params: [
      { key: 'text', label: '文字列', type: 'text', def: 'HELLO' },
      { key: 'cellSize', label: '1マス（機体間隔）[m]', min: 1, max: 20, step: 0.5, def: 5 },
      { key: 'z', label: '下端高度 [m]', min: 0, max: 150, step: 1, def: 30 },
    ],
  },
  wave: {
    label: '波（グリッド変形）',
    gen: wave,
    params: [
      { key: 'cols', label: '列数', min: 1, max: 40, step: 1, def: 10 },
      { key: 'spacing', label: '間隔 [m]', min: 1, max: 20, step: 0.5, def: 8 },
      { key: 'amplitude', label: '振幅 [m]', min: 0, max: 40, step: 1, def: 12 },
      { key: 'wavelength', label: '波長 [m]', min: 5, max: 200, step: 1, def: 60 },
      { key: 'z', label: '基準高度 [m]', min: 0, max: 150, step: 1, def: 45 },
    ],
  },
  scatter: {
    label: '散開（雲）',
    gen: scatter,
    params: [
      { key: 'radius', label: '半径 [m]', min: 5, max: 150, step: 1, def: 50 },
      { key: 'thickness', label: '厚み [m]', min: 0, max: 80, step: 1, def: 25 },
      { key: 'z', label: '中心高度 [m]', min: 0, max: 150, step: 1, def: 50 },
      { key: 'seed', label: '乱数シード', min: 1, max: 9999, step: 1, def: 42 },
    ],
  },
};

/** 種別のデフォルトパラメータを生成する。 */
export function defaultParams(type) {
  const out = {};
  for (const p of FORMATIONS[type].params) out[p.key] = p.def;
  return out;
}

/** 欠けているパラメータをデフォルトで補いつつ隊列を生成する。 */
export function generate(type, n, params) {
  const def = FORMATIONS[type];
  if (!def) throw new Error(`未知の隊列種別: ${type}`);
  const merged = { ...defaultParams(type), ...params };
  return def.gen(n, merged);
}
