/**
 * ルート生成と標高プロファイルの取得
 *
 * 日本の自転車ルートは Google のカバレッジが限定的で「経路を計算できません」が
 * 頻発する。そのため BICYCLE → WALK → DRIVE と自動でフォールバックする
 * （要件定義書 F-102）。加えて GPX インポートとプリセットも用意している。
 */

import { getApiKey } from '../config.js';
import { buildPath, decodePolyline, resample, parseGpx, smoothElevations } from './geo.js';

const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const ELEVATION_ENDPOINT = 'https://maps.googleapis.com/maps/api/elevation/json';

/** 3D タイルのカバレッジが確実な地域のプリセットルート（要件定義書 F-104） */
export const PRESET_ROUTES = [
  {
    id: 'imperial-palace',
    name: '皇居一周',
    description: '東京・皇居外周のおよそ5km。定番の周回コース',
    city: '東京',
    loop: true,
    points: [
      { lat: 35.6852, lng: 139.7528 }, { lat: 35.6879, lng: 139.7546 },
      { lat: 35.6907, lng: 139.7548 }, { lat: 35.6929, lng: 139.7529 },
      { lat: 35.6941, lng: 139.7495 }, { lat: 35.6936, lng: 139.7458 },
      { lat: 35.6913, lng: 139.7433 }, { lat: 35.6884, lng: 139.7425 },
      { lat: 35.6854, lng: 139.7434 }, { lat: 35.6829, lng: 139.7455 },
      { lat: 35.6816, lng: 139.7484 }, { lat: 35.6826, lng: 139.7513 },
      { lat: 35.6852, lng: 139.7528 },
    ],
  },
  {
    id: 'osaka-castle',
    name: '大阪城公園',
    description: '大阪城の堀に沿った約4kmの周回',
    city: '大阪',
    loop: true,
    points: [
      { lat: 34.6873, lng: 135.5259 }, { lat: 34.6895, lng: 135.5281 },
      { lat: 34.6908, lng: 135.5312 }, { lat: 34.6901, lng: 135.5345 },
      { lat: 34.6878, lng: 135.5361 }, { lat: 34.6852, lng: 135.5353 },
      { lat: 34.6835, lng: 135.5327 }, { lat: 34.6840, lng: 135.5292 },
      { lat: 34.6856, lng: 135.5268 }, { lat: 34.6873, lng: 135.5259 },
    ],
  },
  {
    id: 'kamogawa',
    name: '鴨川沿い',
    description: '京都・鴨川に沿って北上する約6km',
    city: '京都',
    loop: false,
    points: [
      { lat: 34.9971, lng: 135.7710 }, { lat: 35.0021, lng: 135.7715 },
      { lat: 35.0075, lng: 135.7719 }, { lat: 35.0128, lng: 135.7722 },
      { lat: 35.0182, lng: 135.7724 }, { lat: 35.0234, lng: 135.7729 },
      { lat: 35.0289, lng: 135.7737 }, { lat: 35.0341, lng: 135.7751 },
      { lat: 35.0396, lng: 135.7768 }, { lat: 35.0448, lng: 135.7784 },
    ],
  },
  {
    id: 'golden-gate',
    name: 'ゴールデンゲートブリッジ',
    description: 'サンフランシスコ湾を渡る約3km。3Dタイルの見応えが随一',
    city: 'サンフランシスコ',
    loop: false,
    points: [
      { lat: 37.8065, lng: -122.4750 }, { lat: 37.8103, lng: -122.4763 },
      { lat: 37.8150, lng: -122.4780 }, { lat: 37.8199, lng: -122.4785 },
      { lat: 37.8249, lng: -122.4788 }, { lat: 37.8298, lng: -122.4791 },
      { lat: 37.8341, lng: -122.4794 },
    ],
  },
  {
    id: 'seine',
    name: 'セーヌ川沿い',
    description: 'パリ中心部・セーヌ川右岸を走る約4km',
    city: 'パリ',
    loop: false,
    points: [
      { lat: 48.8530, lng: 2.3499 }, { lat: 48.8558, lng: 2.3435 },
      { lat: 48.8582, lng: 2.3369 }, { lat: 48.8601, lng: 2.3288 },
      { lat: 48.8617, lng: 2.3212 }, { lat: 48.8635, lng: 2.3135 },
      { lat: 48.8646, lng: 2.3049 }, { lat: 48.8637, lng: 2.2967 },
      { lat: 48.8611, lng: 2.2921 }, { lat: 48.8584, lng: 2.2945 },
    ],
  },
];

/**
 * Routes API で2地点間のルートを取得する。
 * BICYCLE が使えない地域では WALK → DRIVE と自動的に切り替える。
 *
 * waypoints を渡すと、それらの地点を順番に経由するルートを生成する。
 * プリセットルートの概算座標を経由地点として渡し、実際の道路にスナップ
 * させる用途で使う（routeFromPresetRefined）。
 *
 * @returns {{path: object, mode: string, warning: string|null}}
 */
export async function fetchRoute(origin, destination, waypoints = []) {
  const key = getApiKey();
  if (!key) throw new Error('API キーが未設定です');

  const modes = ['BICYCLE', 'WALK', 'DRIVE'];
  const errors = [];

  for (const mode of modes) {
    try {
      const res = await fetch(ROUTES_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify({
          origin: { location: { latLng: toLatLng(origin) } },
          destination: { location: { latLng: toLatLng(destination) } },
          ...(waypoints.length
            ? { intermediates: waypoints.map((p) => ({ location: { latLng: toLatLng(p) } })) }
            : {}),
          travelMode: mode,
          polylineQuality: 'HIGH_QUALITY',
          ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        errors.push(`${mode}: HTTP ${res.status} ${body.slice(0, 200)}`);
        continue;
      }

      const json = await res.json();
      const encoded = json?.routes?.[0]?.polyline?.encodedPolyline;
      if (!encoded) {
        errors.push(`${mode}: 経路が見つかりません`);
        continue;
      }

      return {
        path: buildPath(decodePolyline(encoded)),
        mode,
        // 自転車ルートは beta のため警告表示が義務（要件定義書 L-05）
        warning:
          mode === 'BICYCLE'
            ? '自転車ルートはベータ提供です。実際の道路状況とは異なる場合があります。'
            : mode === 'WALK'
              ? '自転車ルートが見つからなかったため、徒歩ルートを使用しています。'
              : '自転車・徒歩ルートが見つからなかったため、自動車ルートを使用しています。',
      };
    } catch (err) {
      errors.push(`${mode}: ${err.message}`);
    }
  }

  throw new Error(`ルートを生成できませんでした。\n${errors.join('\n')}`);
}

function toLatLng(p) {
  return { latitude: p.lat, longitude: p.lng };
}

/**
 * 経路の標高プロファイルを取得する。
 * Elevation API は1リクエストあたりの点数に上限があるため、
 * 経路を最大 samples 点に間引いてから問い合わせる。
 *
 * 取得に失敗しても走行は継続できるよう、空配列を返して呼び出し側で吸収する。
 */
export async function fetchElevations(path, samples = 300) {
  const key = getApiKey();
  if (!key) return [];

  const sampled = resample(path, Math.min(samples, path.points.length * 2));
  const locations = sampled.map((p) => `${p.lat},${p.lng}`).join('|');

  try {
    const url = `${ELEVATION_ENDPOINT}?locations=${encodeURIComponent(locations)}&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    if (json.status !== 'OK' || !Array.isArray(json.results)) return [];

    const sampledElevations = json.results.map((r) => r.elevation);
    // Elevation API の実測値には数十cm〜数m単位のノイズが乗るため、
    // 全点へ伸ばす前に平滑化しておく（勾配連動の精度に直結する）
    const smoothed = smoothElevations(sampledElevations);
    // 間引いた標高を、経路の全点数に線形補間で戻す
    return expandToPathPoints(smoothed, path.points.length);
  } catch {
    return [];
  }
}

/** n 点の配列を m 点に線形補間で伸縮する */
export function expandToPathPoints(values, targetLength) {
  if (values.length === 0) return [];
  if (values.length === targetLength) return values.slice();
  const out = new Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    const pos = (i / Math.max(1, targetLength - 1)) * (values.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const t = pos - lo;
    out[i] = values[lo] + (values[hi] - values[lo]) * t;
  }
  return out;
}

/** プリセット定義から走行可能なルートを作る（座標をそのまま直線で結ぶ概算ルート） */
export function routeFromPreset(preset) {
  return {
    path: buildPath(preset.points),
    mode: 'PRESET',
    warning: null,
    loop: preset.loop,
    name: preset.name,
  };
}

/** Routes API の経由地点として渡す座標の上限（API 自体の上限は25地点、余裕を持たせる） */
const MAX_PRESET_WAYPOINTS = 20;

const PRESET_NO_KEY_WARNING =
  'API キーが未設定のため、概算のルートで表示しています。実際の道路とズレる場合があります。';
const PRESET_REFINE_FAILED_WARNING =
  '実際の道路に沿ったルートを取得できなかったため、概算のルートで表示しています。実際の道路とズレる場合があります。';

/**
 * プリセットの概算座標を Routes API の経由地点として渡し、実際の道路に
 * スナップさせたルートを作る。プリセット座標は手作業による粗い近似のため、
 * そのまま `routeFromPreset` で結ぶと建物や川を直線で突っ切ってしまう問題への対応。
 *
 * API キーが無い場合や取得に失敗した場合は、警告付きで従来の概算ルート
 * （routeFromPreset）にフォールバックする。
 */
export async function routeFromPresetRefined(preset) {
  if (!getApiKey()) return { ...routeFromPreset(preset), warning: PRESET_NO_KEY_WARNING };

  try {
    const refined = preset.loop
      ? await fetchLoopRoute(preset.points)
      : await fetchRoute(
          preset.points[0],
          preset.points[preset.points.length - 1],
          thinWaypoints(preset.points.slice(1, -1), MAX_PRESET_WAYPOINTS)
        );
    return { ...refined, mode: 'PRESET', loop: preset.loop, name: preset.name };
  } catch {
    return { ...routeFromPreset(preset), warning: PRESET_REFINE_FAILED_WARNING };
  }
}

/**
 * 始点=終点のループルートを Routes API で取得する。
 *
 * origin と destination に全く同じ座標を渡すと、ルーティングエンジンが
 * 経由地点を無視した退化した結果（皇居一周が皇居内を突っ切る等）を返す
 * ことがある。始点の反対側にあたる点でループを2区間に分割し、区間ごとに
 * 別の座標を始点・終点として取得してから連結することでこれを避ける。
 */
async function fetchLoopRoute(points) {
  const middle = points.slice(1, -1);
  // 分割できるだけの中間点が無いループは、始点=終点の退化リクエストになるため諦める
  // （呼び出し元 routeFromPresetRefined が概算ルートへフォールバックする）
  if (middle.length === 0) throw new Error('ループを分割できる中間点がありません');

  const splitIndex = Math.floor(middle.length / 2);
  const farSide = middle[splitIndex];
  const halfMax = Math.max(1, Math.floor(MAX_PRESET_WAYPOINTS / 2));
  const outboundWaypoints = thinWaypoints(middle.slice(0, splitIndex), halfMax);
  const inboundWaypoints = thinWaypoints(middle.slice(splitIndex + 1), halfMax);

  const [outbound, inbound] = await Promise.all([
    fetchRoute(points[0], farSide, outboundWaypoints),
    fetchRoute(farSide, points[0], inboundWaypoints),
  ]);

  // 片方の区間だけ自転車ルートが無く自動車にフォールバックしている場合があるため、
  // より制限の強い（＝警告すべき）側の結果を代表として使う
  const travelModes = ['BICYCLE', 'WALK', 'DRIVE'];
  const weaker = travelModes.indexOf(outbound.mode) >= travelModes.indexOf(inbound.mode) ? outbound : inbound;

  return {
    path: buildPath([...outbound.path.points, ...inbound.path.points]),
    mode: weaker.mode,
    warning: weaker.warning,
  };
}

/** 経由地点の配列を max 個以下になるよう均等に間引く */
export function thinWaypoints(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  return out;
}

/** GPX ファイル（File オブジェクト）からルートを作る */
export async function routeFromGpxFile(file) {
  const text = await file.text();
  const points = parseGpx(text);
  const path = buildPath(points);

  // GPX に標高が含まれていれば Elevation API を呼ばずに済む。
  // GPS由来の標高（特にバロメーターではなく衛星測位由来のもの）は
  // 数m単位でばらつくため、Elevation API と同様に平滑化する
  const hasEle = points.every((p) => Number.isFinite(p.ele));
  const elevations = hasEle
    ? expandToPathPoints(smoothElevations(points.map((p) => p.ele)), path.points.length)
    : [];

  return {
    path,
    elevations,
    mode: 'GPX',
    warning: null,
    loop: false,
    name: file.name.replace(/\.gpx$/i, ''),
  };
}
