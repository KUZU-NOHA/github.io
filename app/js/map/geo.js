/**
 * 地理計算ユーティリティ（純粋関数のみ・DOM 非依存）
 *
 * ルートを「距離でインデックスできる経路」に変換し、走行距離から
 * 現在位置・進行方位・勾配を引けるようにするのがこのモジュールの役割。
 */

const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** 2点間の大円距離[m] */
export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** a から b を見たときの方位角[度]（真北基準・0〜360） */
export function bearing(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** 角度を -180〜180 に正規化（方位の補間で使う） */
export function normalizeAngle(deg) {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  return a;
}

/** 2つの方位角を比率 t で補間（360度の折返しを跨いでも最短経路で回る） */
export function lerpAngle(from, to, t) {
  return (from + normalizeAngle(to - from) * t + 360) % 360;
}

/**
 * Google Encoded Polyline を座標配列に展開する。
 * Routes API / Directions API が返す経路形式。
 */
export function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/**
 * 座標配列から「距離で引ける経路」を構築する。
 *
 * cumulative[i] は始点から points[i] までの累積距離[m]。
 * 走行中は毎フレーム pointAt() を呼ぶため、ここで前計算しておく。
 */
export function buildPath(points) {
  const pts = dedupe(points);
  if (pts.length < 2) {
    throw new Error('経路には2点以上が必要です');
  }
  const cumulative = [0];
  for (let i = 1; i < pts.length; i++) {
    cumulative[i] = cumulative[i - 1] + haversine(pts[i - 1], pts[i]);
  }
  return {
    points: pts,
    cumulative,
    totalDistanceM: cumulative[cumulative.length - 1],
  };
}

/** 同一座標の連続を除去（距離0の区間は方位が計算できないため） */
function dedupe(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.abs(prev.lat - p.lat) > 1e-9 || Math.abs(prev.lng - p.lng) > 1e-9) {
      out.push({ lat: p.lat, lng: p.lng });
    }
  }
  return out;
}

/** 累積距離配列に対する二分探索。distance を含む区間の開始インデックスを返す */
function segmentIndexAt(cumulative, distance) {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= distance) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * 走行距離[m] における経路上の位置・方位を返す。
 * 経路長を超えた場合は終点に張り付く（周回させたい場合は呼び出し側で剰余を取る）。
 */
export function pointAt(path, distanceM) {
  const { points, cumulative, totalDistanceM } = path;
  const d = Math.max(0, Math.min(distanceM, totalDistanceM));
  const i = segmentIndexAt(cumulative, d);
  const j = Math.min(i + 1, points.length - 1);

  const segLen = cumulative[j] - cumulative[i];
  const t = segLen > 0 ? (d - cumulative[i]) / segLen : 0;

  const a = points[i];
  const b = points[j];
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    heading: a === b ? 0 : bearing(a, b),
    segmentIndex: i,
    t,
  };
}

/**
 * 標高配列（経路の各点に対応）から、指定距離地点の標高[m]を線形補間で返す。
 */
export function elevationAt(path, elevations, distanceM) {
  if (!elevations || elevations.length === 0) return 0;
  const { cumulative, totalDistanceM } = path;
  const d = Math.max(0, Math.min(distanceM, totalDistanceM));
  const i = segmentIndexAt(cumulative, d);
  const j = Math.min(i + 1, elevations.length - 1);
  const segLen = cumulative[j] - cumulative[i];
  const t = segLen > 0 ? (d - cumulative[i]) / segLen : 0;
  const ea = elevations[Math.min(i, elevations.length - 1)];
  const eb = elevations[j];
  return ea + (eb - ea) * t;
}

/**
 * 指定距離地点の勾配[%] を返す。
 *
 * windowM で前後の標高差をならす。生の点間勾配は標高データのノイズで
 * 大きく暴れるため、そのままトレーナーに送ると負荷がガタつく。
 */
export function gradeAt(path, elevations, distanceM, windowM = 40) {
  if (!elevations || elevations.length < 2) return 0;
  const total = path.totalDistanceM;
  const back = Math.max(0, distanceM - windowM / 2);
  const fwd = Math.min(total, distanceM + windowM / 2);
  const run = fwd - back;
  if (run < 1) return 0;
  const rise = elevationAt(path, elevations, fwd) - elevationAt(path, elevations, back);
  const grade = (rise / run) * 100;
  // 実在しない急勾配は測定ノイズなので丸める
  return Math.max(-25, Math.min(25, grade));
}

/**
 * 経路を等間隔で sampleCount 点にリサンプルする。
 * Elevation API は 1リクエストあたりの点数に上限があるため、
 * 標高取得前に経路を間引く用途で使う。
 */
export function resample(path, sampleCount) {
  const n = Math.max(2, Math.min(sampleCount, 512));
  const step = path.totalDistanceM / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pointAt(path, step * i);
    out.push({ lat: p.lat, lng: p.lng });
  }
  return out;
}

/** GPX テキストから座標配列を取り出す（trkpt / rtept / wpt に対応） */
export function parseGpx(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('GPX ファイルを解析できませんでした');
  }
  const nodes = doc.querySelectorAll('trkpt, rtept, wpt');
  const points = [];
  for (const n of nodes) {
    const lat = parseFloat(n.getAttribute('lat'));
    const lng = parseFloat(n.getAttribute('lon'));
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const eleNode = n.querySelector('ele');
      points.push({
        lat,
        lng,
        ele: eleNode ? parseFloat(eleNode.textContent) : undefined,
      });
    }
  }
  if (points.length < 2) {
    throw new Error('GPX に十分な座標が含まれていません');
  }
  return points;
}
