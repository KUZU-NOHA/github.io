/**
 * ルート生成と標高プロファイルの取得
 *
 * 日本の自転車ルートは Google のカバレッジが限定的で「経路を計算できません」が
 * 頻発する。そのため BICYCLE → WALK → DRIVE と自動でフォールバックする
 * （要件定義書 F-102）。加えて GPX インポートとプリセットも用意している。
 */

import { getApiKey, hasLicenseKey, backendAuthHeaders, BACKEND_BASE_URL } from '../config.js';
import {
  buildPath, decodePolyline, resample, parseGpx, smoothElevationsByDistance,
} from './geo.js';

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
    name: '皇居・東京タワー',
    description: '皇居から東京タワー方面へ走るコース（約9.7km）',
    city: '東京',
    loop: false,
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
  {
    id: 'nihonbashi-shinagawa',
    name: '日本橋・品川',
    description: '日本橋から品川方面へ走るコース（約7.9km）',
    city: '東京',
    loop: false,
    gpxUrl: 'routes/nihonbashi-shinagawa.gpx',
  },
  {
    id: 'shibuya-aoyama',
    name: '渋谷・青山',
    description: '渋谷・青山エリアを周回するコース（約8.0km）',
    city: '東京',
    loop: true,
    gpxUrl: 'routes/shibuya-aoyama.gpx',
  },
  {
    id: 'yaesu-kokyo-loop',
    name: '八重洲口・皇居一周',
    description: '八重洲口から皇居の周りを一周するコース（約7.0km）',
    city: '東京',
    loop: true,
    gpxUrl: 'routes/yaesu-kokyo-loop.gpx',
  },
];

/**
 * Routes API で2地点間のルートを取得する（地点を指定してのルート生成用）。
 * BICYCLE が使えない地域では WALK → DRIVE と自動的に切り替える。
 *
 * サブスクのライセンスキーがあればバックエンド（系統A、要件定義書 7.5）
 * 経由で呼ぶ。バックエンドが不通の場合は BYOK キーがあればそちらに
 * フォールバックする。
 *
 * @returns {{path: object, mode: string, warning: string|null}}
 */
export async function fetchRoute(origin, destination) {
  const useBackend = hasLicenseKey();
  const key = getApiKey();
  if (!useBackend && !key) throw new Error('API キーが未設定です');

  if (useBackend) {
    try {
      return await attemptRouteFetch(origin, destination, (mode) =>
        callRoutesApi(origin, destination, mode, { viaBackend: true })
      );
    } catch (err) {
      if (!key) throw new Error(`ルートを生成できませんでした。\n${err.message}`);
      // バックエンド不通時は BYOK にフォールバックする（下へ続く）
    }
  }

  try {
    return await attemptRouteFetch(origin, destination, (mode) =>
      callRoutesApi(origin, destination, mode, { viaBackend: false, key })
    );
  } catch (err) {
    throw new Error(`ルートを生成できませんでした。\n${err.message}`);
  }
}

/** BICYCLE → WALK → DRIVE の順で試し、最初に成功したものを返す（呼び出し方法は callGoogle に委譲） */
async function attemptRouteFetch(origin, destination, callGoogle) {
  const modes = ['BICYCLE', 'WALK', 'DRIVE'];
  const errors = [];

  for (const mode of modes) {
    try {
      const encoded = await callGoogle(mode);
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

  throw new Error(errors.join('\n'));
}

async function callRoutesApi(origin, destination, mode, { viaBackend, key }) {
  const body = JSON.stringify({
    origin: { location: { latLng: toLatLng(origin) } },
    destination: { location: { latLng: toLatLng(destination) } },
    travelMode: mode,
    polylineQuality: 'HIGH_QUALITY',
    ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
  });

  const res = await fetch(
    viaBackend ? `${BACKEND_BASE_URL}/api/maps/routes` : ROUTES_ENDPOINT,
    {
      method: 'POST',
      headers: viaBackend
        ? { 'Content-Type': 'application/json', ...backendAuthHeaders() }
        : {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask':
              'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration',
          },
      body,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  return json?.routes?.[0]?.polyline?.encodedPolyline;
}

function toLatLng(p) {
  return { latitude: p.lat, longitude: p.lng };
}

/**
 * 経路の標高プロファイルを取得する。
 * Elevation API は1リクエストあたりの点数に上限があるため、
 * 経路を最大 samples 点に間引いてから問い合わせる。
 *
 * サブスクのライセンスキーがあればバックエンド（系統A）経由、
 * 無ければ／不通ならBYOKキーで直接、の順で試す。
 * 取得に失敗しても走行は継続できるよう、空配列を返して呼び出し側で吸収する。
 */
export async function fetchElevations(path, samples = 300) {
  const useBackend = hasLicenseKey();
  const key = getApiKey();
  if (!useBackend && !key) return [];

  const sampled = resample(path, Math.min(samples, path.points.length * 2));
  const results = await resolveElevationResults(sampled, useBackend, key);
  if (!results) return [];

  // Elevation API の実測値には数十cm〜数m単位のノイズが乗るため、
  // 全点へ伸ばす前に平滑化しておく（勾配連動の精度に直結する）
  const sampledWithEle = sampled.map((p, i) => ({ ...p, ele: results[i].elevation }));
  const smoothed = smoothElevationsByDistance(sampledWithEle);
  // 間引いた標高を、経路の全点数に線形補間で戻す
  return expandToPathPoints(smoothed, path.points.length);
}

async function resolveElevationResults(sampled, useBackend, key) {
  if (useBackend) {
    try {
      const results = await callElevationApi(sampled, { viaBackend: true });
      if (results) return results;
    } catch {
      /* バックエンド不通時は BYOK があれば下でフォールバックする */
    }
  }
  if (!key) return null;
  try {
    return await callElevationApi(sampled, { viaBackend: false, key });
  } catch {
    return null;
  }
}

async function callElevationApi(sampled, { viaBackend, key }) {
  const locations = sampled.map((p) => `${p.lat},${p.lng}`).join('|');
  const url = viaBackend
    ? `${BACKEND_BASE_URL}/api/maps/elevation?locations=${encodeURIComponent(locations)}`
    : `${ELEVATION_ENDPOINT}?locations=${encodeURIComponent(locations)}&key=${key}`;
  const res = await fetch(url, viaBackend ? { headers: backendAuthHeaders() } : undefined);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.status !== 'OK' || !Array.isArray(json.results)) return null;
  return json.results;
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
 * （特にバロメーターではなく衛星測位由来のもの）には数m単位のノイズに加え、
 * 建物や樹木の影響で数百m単位のまとまった誤差が乗ることがあるため、
 * 実距離ベースで平滑化する（smoothElevationsByDistance）。GPX の記録点
 * 間隔は低速時や旋回時に密集し高速時に疎になるなど不均一なので、点数
 * ベースの平滑化では密度によって効き目が変わってしまう。
 */
function buildGpxRoute(text, { name, loop = false }) {
  const points = parseGpx(text);
  const path = buildPath(points);

  const hasEle = points.every((p) => Number.isFinite(p.ele));
  const elevations = hasEle
    ? expandToPathPoints(smoothElevationsByDistance(points), path.points.length)
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
