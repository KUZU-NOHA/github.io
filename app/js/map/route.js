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

/**
 * プリセットルート（要件定義書 F-104）。
 *
 * 座標は手作業の近似ではなく、Ride with GPS で実際に記録・計画された
 * GPX ファイル（`app/routes/*.gpx`、実行時に fetch して読み込む）を使う。
 * そのため API キーが無くても、常に実際の道路に沿った正確な経路になる。
 */
export const PRESET_ROUTES = [
  {
    id: 'imperial-palace',
    name: '皇居一周',
    description: '東京・皇居外周を1周する定番コース（約5km）',
    city: '東京',
    loop: true,
    gpxUrl: 'routes/imperial-palace.gpx',
  },
  {
    id: 'osaka-castle',
    name: '大阪城天守閣＋標高0m',
    description: '大阪城公園内、標高0m地点を含む約7.7km',
    city: '大阪',
    loop: false,
    gpxUrl: 'routes/osaka-castle.gpx',
  },
  {
    id: 'golden-gate',
    name: 'ゴールデンゲートブリッジ',
    description: 'サンフランシスコ湾を渡るロングライド（約20km）',
    city: 'サンフランシスコ',
    loop: false,
    gpxUrl: 'routes/golden-gate.gpx',
  },
  {
    id: 'seine',
    name: 'セーヌ川',
    description: 'パリからセーヌ川沿いを河口方面へ走るロングルート（約287km）',
    city: 'パリ',
    loop: false,
    gpxUrl: 'routes/seine.gpx',
  },
  {
    id: 'oga-peninsula',
    name: '寒風山・男鹿半島',
    description: '秋田・男鹿半島の寒風山を含む山岳ルート（約166km）',
    city: '秋田',
    loop: false,
    gpxUrl: 'routes/oga-peninsula.gpx',
  },
];

/**
 * Routes API で2地点間のルートを取得する（地点を指定してのルート生成用）。
 * BICYCLE が使えない地域では WALK → DRIVE と自動的に切り替える。
 *
 * @returns {{path: object, mode: string, warning: string|null}}
 */
export async function fetchRoute(origin, destination) {
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

/**
 * GPX テキストから走行可能なルートを作る（GPX インポート・プリセット共通処理）。
 *
 * GPX に標高が含まれていれば Elevation API を呼ばずに済む。GPS由来の標高
 * （特にバロメーターではなく衛星測位由来のもの）は数m単位でばらつくため、
 * Elevation API 由来の標高と同様に平滑化する。
 */
function buildGpxRoute(text, { name, loop = false }) {
  const points = parseGpx(text);
  const path = buildPath(points);

  const hasEle = points.every((p) => Number.isFinite(p.ele));
  const elevations = hasEle
    ? expandToPathPoints(smoothElevations(points.map((p) => p.ele)), path.points.length)
    : [];

  return { path, elevations, mode: 'GPX', warning: null, loop, name };
}

/** GPX ファイル（File オブジェクト）からルートを作る */
export async function routeFromGpxFile(file) {
  const text = await file.text();
  return buildGpxRoute(text, { name: file.name.replace(/\.gpx$/i, '') });
}

/** プリセットに同梱された GPX ファイルを取得してルートを作る */
export async function routeFromPresetGpx(preset) {
  const res = await fetch(preset.gpxUrl);
  if (!res.ok) throw new Error(`プリセットの GPX を読み込めませんでした（${preset.name}）`);
  const text = await res.text();
  return buildGpxRoute(text, { name: preset.name, loop: preset.loop });
}
