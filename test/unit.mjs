/**
 * 純粋ロジックの単体テスト（Node で実行 / ブラウザ不要）
 *
 *   node --test test/unit.mjs
 *
 * FTMS のバイトレイアウトは実機なしでは間違いに気づけないため、
 * 既知のバイト列を流して期待値と突き合わせる。特に Flags bit 0 の
 * 論理反転（要件定義書 5.2 の警告）は必ず検証する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  haversine, bearing, decodePolyline, buildPath, pointAt,
  elevationAt, gradeAt, resample, lerpAngle, normalizeAngle, smoothElevationsByDistance,
} from '../app/js/map/geo.js';
import {
  parseIndoorBikeData, buildSimulationCommand, parseFeatureFlags,
} from '../app/js/ble/ftms.js';
import { parseHeartRate } from '../app/js/ble/heartRate.js';
import {
  kcalFromPower, kcalFromMet, estimateMet, zoneFor, maxHeartRate,
  CalorieAccumulator,
} from '../app/js/ride/calories.js';
import {
  buildUnlockCommand, buildSimGradeCommand, buildSimModeCommand, buildErgCommand,
} from '../app/js/ble/wahoo.js';
import { parseCscMeasurement } from '../app/js/ble/csc.js';
import { parseCyclingPowerMeasurement } from '../app/js/ble/cyclingPower.js';
import {
  speedFromPower, powerRequired, RevolutionCounter, Smoother,
  speedFromWheel, cadenceFromCrank, isPlausibleSpeed, isPlausibleCadence,
  BIKE_PROFILES, profileFor, trainerWindResistance,
} from '../app/js/ride/physics.js';
import { expandToPathPoints, fetchRoute, fetchElevations, PRESET_ROUTES } from '../app/js/map/route.js';
import {
  setApiKey, getLicenseKey, setLicenseKey, hasLicenseKey,
  getLicenseEmail, setLicenseEmail, backendAuthHeaders,
} from '../app/js/config.js';
import { isLicenseActive, clearLicenseCache, hashToken } from '../server/lib/licenses.js';
import { requireLicense } from '../server/lib/requireLicense.js';
import { withCors } from '../server/lib/cors.js';
import { latLngToWorldPoint, zoomForBounds } from '../app/js/map/fallback2d.js';
import { RideEngine } from '../app/js/ride/engine.js';
import {
  currentStreak, kcalWithin, zoneTotals, predictGoalDate, sessionsToCsv,
  routeKeyFor, bestGhostFor,
} from '../app/js/store/sessions.js';

/* ============ 地理計算 ============ */

test('haversine: 東京駅〜横浜駅は約27km', () => {
  const d = haversine({ lat: 35.6812, lng: 139.7671 }, { lat: 35.4658, lng: 139.6222 });
  assert.ok(d > 26000 && d < 29000, `実際: ${d}`);
});

test('bearing: 真北・真東を正しく返す', () => {
  assert.ok(Math.abs(bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 0) < 0.01);
  assert.ok(Math.abs(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 90) < 0.01);
});

test('normalizeAngle / lerpAngle: 360度の折返しを最短で回る', () => {
  assert.equal(normalizeAngle(370), 10);
  assert.equal(normalizeAngle(-190), 170);
  // 350度 → 10度 は +20度側に回るべき（-340度側ではない）
  const mid = lerpAngle(350, 10, 0.5);
  assert.ok(Math.abs(mid - 0) < 0.001 || Math.abs(mid - 360) < 0.001, `実際: ${mid}`);
});

test('decodePolyline: Google のリファレンス値を復元できる', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(pts.length, 3);
  assert.ok(Math.abs(pts[0].lat - 38.5) < 1e-5);
  assert.ok(Math.abs(pts[0].lng - -120.2) < 1e-5);
  assert.ok(Math.abs(pts[2].lat - 43.252) < 1e-5);
  assert.ok(Math.abs(pts[2].lng - -126.453) < 1e-5);
});

test('buildPath: 累積距離を正しく積む', () => {
  const path = buildPath([
    { lat: 35.0, lng: 139.0 },
    { lat: 35.01, lng: 139.0 },
    { lat: 35.02, lng: 139.0 },
  ]);
  assert.equal(path.cumulative[0], 0);
  assert.ok(path.cumulative[1] > 1000 && path.cumulative[1] < 1200);
  // 等間隔なので合計は1区間のちょうど2倍になるはず
  assert.ok(Math.abs(path.totalDistanceM - path.cumulative[1] * 2) < 1);
});

test('buildPath: 重複点を除去する（距離0区間で方位が壊れるのを防ぐ）', () => {
  const path = buildPath([
    { lat: 35.0, lng: 139.0 },
    { lat: 35.0, lng: 139.0 },
    { lat: 35.01, lng: 139.0 },
  ]);
  assert.equal(path.points.length, 2);
});

test('buildPath: 2点未満は例外', () => {
  assert.throws(() => buildPath([{ lat: 35, lng: 139 }]));
});

test('pointAt: 中間地点を補間し、範囲外は端に張り付く', () => {
  const path = buildPath([
    { lat: 35.0, lng: 139.0 },
    { lat: 35.02, lng: 139.0 },
  ]);
  const mid = pointAt(path, path.totalDistanceM / 2);
  assert.ok(Math.abs(mid.lat - 35.01) < 1e-4, `実際: ${mid.lat}`);

  const over = pointAt(path, path.totalDistanceM * 5);
  assert.ok(Math.abs(over.lat - 35.02) < 1e-6);

  const under = pointAt(path, -500);
  assert.ok(Math.abs(under.lat - 35.0) < 1e-6);
});

test('elevationAt / gradeAt: 上り勾配を正しく算出する', () => {
  // 約1.1km で 100m 上る ≒ 9%
  const path = buildPath([
    { lat: 35.0, lng: 139.0 },
    { lat: 35.01, lng: 139.0 },
  ]);
  const elevations = [0, 100];
  const half = elevationAt(path, elevations, path.totalDistanceM / 2);
  assert.ok(Math.abs(half - 50) < 1, `実際: ${half}`);

  const g = gradeAt(path, elevations, path.totalDistanceM / 2);
  assert.ok(g > 8 && g < 10, `実際: ${g}`);
});

test('gradeAt: 標高データが無ければ 0 を返す（走行は継続できる）', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.01, lng: 139 }]);
  assert.equal(gradeAt(path, [], 100), 0);
  assert.equal(gradeAt(path, null, 100), 0);
});

test('gradeAt: 非現実的な急勾配は ±15% に丸める', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.0002, lng: 139 }]);
  const g = gradeAt(path, [0, 1000], 10);
  assert.ok(g <= 15 && g >= -15, `実際: ${g}`);
});

test('smoothElevationsByDistance: 単発のノイズを均す', () => {
  // 約111mおきに並ぶ平坦な地形の途中に1点だけ大きな外れ値が混ざったケース
  const points = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
    lat: 35 + i * 0.001, lng: 139, ele: i === 3 ? 130 : 100,
  }));
  const smoothed = smoothElevationsByDistance(points, 400);
  assert.ok(smoothed[3] < 115, `外れ値が均されていない: ${smoothed[3]}`);
  // 端に近い点も配列外参照せず計算できること
  assert.ok(Number.isFinite(smoothed[0]));
  assert.ok(Number.isFinite(smoothed[6]));
});

test('smoothElevationsByDistance: 記録密度が不均一でも実距離の窓でならす', () => {
  // GPX は低速時・旋回時に記録点が密集し、高速時は疎になる。
  // 序盤は密（約11mおき）に記録され、その中に1点だけ外れ値が混ざっている。
  // 後半は疎（約555mおき）に記録された平坦な区間
  const dense = Array.from({ length: 8 }, (_, i) => ({
    lat: 35 + i * 0.0001, lng: 139, ele: i === 4 ? 130 : 100,
  }));
  const sparse = Array.from({ length: 4 }, (_, i) => ({
    lat: 35 + 0.0007 + (i + 1) * 0.005, lng: 139, ele: 100,
  }));
  const points = [...dense, ...sparse];
  const smoothed = smoothElevationsByDistance(points, 300);
  // 密な区間の外れ値は、実距離300mの窓に密集した近傍点が多く入るためよく均される
  assert.ok(smoothed[4] < 110, `密な区間の外れ値が均されていない: ${smoothed[4]}`);
  // 疎な区間はノイズが無いので、遠く離れた密な区間に値を引っ張られず元の値のまま
  assert.ok(Math.abs(smoothed[smoothed.length - 1] - 100) < 5,
    `疎な区間の値が変わってしまった: ${smoothed[smoothed.length - 1]}`);
});

test('smoothElevationsByDistance: 点数が少なければそのまま標高だけ返す', () => {
  const points = [{ lat: 35, lng: 139, ele: 1 }, { lat: 35.001, lng: 139, ele: 2 }];
  assert.deepEqual(smoothElevationsByDistance(points), [1, 2]);
  assert.deepEqual(smoothElevationsByDistance([]), []);
  assert.deepEqual(smoothElevationsByDistance(null), []);
});

test('smoothElevationsByDistance: 元の配列を破壊しない', () => {
  const points = [0, 1, 2, 3, 4].map((i) => ({
    lat: 35 + i * 0.001, lng: 139, ele: i % 2 === 0 ? 10 : 50,
  }));
  const copy = points.map((p) => ({ ...p }));
  smoothElevationsByDistance(points);
  assert.deepEqual(points, copy);
});

test('gradeAt: 平滑化した標高を使うとノイズ由来の急勾配が緩和される', () => {
  // 6mごとの点に1点だけ+5mのノイズが混ざったほぼ平坦な地形（1.2km）
  const latLngs = Array.from({ length: 11 }, (_, i) => ({ lat: 35 + i * 0.001, lng: 139 }));
  const path = buildPath(latLngs);
  const noisy = [0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0]; // 中央に外れ値
  const points = latLngs.map((p, i) => ({ ...p, ele: noisy[i] }));
  const smoothed = smoothElevationsByDistance(points, 300);

  const midDistance = path.totalDistanceM / 2;
  const gradeNoisy = Math.abs(gradeAt(path, noisy, midDistance));
  const gradeSmoothed = Math.abs(gradeAt(path, smoothed, midDistance));
  assert.ok(gradeSmoothed < gradeNoisy, `平滑化前 ${gradeNoisy} / 平滑化後 ${gradeSmoothed}`);
});

test('resample: 指定点数で等間隔にリサンプルする', () => {
  const path = buildPath([
    { lat: 35.0, lng: 139.0 },
    { lat: 35.05, lng: 139.0 },
  ]);
  const pts = resample(path, 11);
  assert.equal(pts.length, 11);
  assert.ok(Math.abs(pts[5].lat - 35.025) < 1e-4);
  // Elevation API の上限を超えない
  assert.equal(resample(path, 9999).length, 512);
});

test('expandToPathPoints: 間引いた標高を元の点数へ戻す', () => {
  assert.deepEqual(expandToPathPoints([0, 10], 3), [0, 5, 10]);
  assert.equal(expandToPathPoints([], 5).length, 0);
  assert.deepEqual(expandToPathPoints([1, 2, 3], 3), [1, 2, 3]);
});

/* ============ ルート生成 ============ */

// config.js の getApiKey/setApiKey は localStorage を使う。Node には無いので
// このテストファイル専用に最小限のインメモリ実装を用意する
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

// decodePolyline（geo.js）の逆変換。Routes API のモック応答を作るためだけに使う
function encodeSignedValue(v) {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = '';
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  out += String.fromCharCode(n + 63);
  return out;
}
function encodePolyline(points) {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += encodeSignedValue(lat - prevLat) + encodeSignedValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

async function withMockFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('PRESET_ROUTES: 全プリセットが id・gpxUrl・name を一意に持つ', () => {
  assert.ok(PRESET_ROUTES.length >= 5);
  const ids = new Set();
  for (const p of PRESET_ROUTES) {
    assert.ok(p.id && !ids.has(p.id), `id が重複または欠落: ${p.id}`);
    ids.add(p.id);
    assert.ok(p.gpxUrl && p.gpxUrl.endsWith('.gpx'), `gpxUrl が不正: ${p.id}`);
    assert.ok(p.name && p.name.length > 0, `name が空: ${p.id}`);
    assert.equal(typeof p.loop, 'boolean', `loop が boolean でない: ${p.id}`);
  }
});

test('fetchRoute: API キー未設定ならエラーになる', async () => {
  setApiKey('');
  await assert.rejects(
    () => fetchRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }),
    /API キー/
  );
});

test('fetchRoute: BICYCLE で成功すれば取得した経路を返す', async () => {
  setApiKey('TEST_KEY');
  const origin = { lat: 35.0, lng: 135.0 };
  const destination = { lat: 35.01, lng: 135.01 };
  let capturedBody = null;

  await withMockFetch(
    async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          routes: [{ polyline: { encodedPolyline: encodePolyline([origin, destination]) } }],
        }),
      };
    },
    async () => {
      const result = await fetchRoute(origin, destination);
      assert.equal(result.mode, 'BICYCLE');
      assert.equal(result.path.points.length, 2);
      // 自転車ルートは要件定義書 L-05 によりベータ表示の警告が必須
      assert.ok(result.warning && result.warning.includes('ベータ'), result.warning);
    }
  );

  assert.ok(capturedBody, 'fetch が呼ばれていない');
  assert.deepEqual(capturedBody.origin.location.latLng, { latitude: 35.0, longitude: 135.0 });
  setApiKey('');
});

test('fetchRoute: BICYCLE が失敗したら WALK にフォールバックする', async () => {
  setApiKey('TEST_KEY');
  const calledModes = [];

  await withMockFetch(
    async (url, init) => {
      const body = JSON.parse(init.body);
      calledModes.push(body.travelMode);
      if (body.travelMode === 'BICYCLE') return { ok: false, status: 404, text: async () => 'no route' };
      return {
        ok: true,
        json: async () => ({
          routes: [{ polyline: { encodedPolyline: encodePolyline([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]) } }],
        }),
      };
    },
    async () => {
      const result = await fetchRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 });
      assert.equal(result.mode, 'WALK');
      assert.ok(result.warning.includes('徒歩'), result.warning);
    }
  );

  assert.deepEqual(calledModes, ['BICYCLE', 'WALK']);
  setApiKey('');
});

/* ============ サブスク（ライセンスキー）管理 ============ */

test('getLicenseKey/setLicenseKey/hasLicenseKey: 保存・削除ができる', () => {
  setLicenseKey('LICENSE-123');
  assert.equal(getLicenseKey(), 'LICENSE-123');
  assert.ok(hasLicenseKey());
  setLicenseKey('');
  assert.equal(getLicenseKey(), '');
  assert.ok(!hasLicenseKey());
});

test('getLicenseEmail/setLicenseEmail: 前後の空白を取り除いて保存する', () => {
  setLicenseEmail('  user@example.com  ');
  assert.equal(getLicenseEmail(), 'user@example.com');
  setLicenseEmail('');
});

test('backendAuthHeaders: ライセンスキー未設定なら空オブジェクト', () => {
  setLicenseKey('');
  assert.deepEqual(backendAuthHeaders(), {});
});

test('backendAuthHeaders: ライセンスキー設定時は専用ヘッダーを組み立てる', () => {
  setLicenseKey('LICENSE-123');
  setLicenseEmail('user@example.com');
  assert.deepEqual(backendAuthHeaders(), {
    'X-Vcycling-License-Key': 'LICENSE-123',
    'X-Vcycling-License-Email': 'user@example.com',
  });
  setLicenseKey('');
  setLicenseEmail('');
});

test('fetchRoute: サブスク（ライセンスキー）があればバックエンド経由で呼ぶ', async () => {
  setApiKey('');
  setLicenseKey('LICENSE-1');
  setLicenseEmail('user@example.com');
  const origin = { lat: 35.0, lng: 135.0 };
  const destination = { lat: 35.01, lng: 135.01 };
  let capturedUrl = null;
  let capturedHeaders = null;

  await withMockFetch(
    async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init.headers;
      return {
        ok: true,
        json: async () => ({
          routes: [{ polyline: { encodedPolyline: encodePolyline([origin, destination]) } }],
        }),
      };
    },
    async () => {
      const result = await fetchRoute(origin, destination);
      assert.equal(result.mode, 'BICYCLE');
    }
  );

  assert.ok(capturedUrl.includes('/api/maps/routes'), capturedUrl);
  assert.equal(capturedHeaders['X-Vcycling-License-Key'], 'LICENSE-1');
  setLicenseKey('');
  setLicenseEmail('');
});

test('fetchRoute: バックエンドが不通でも API キーがあれば BYOK にフォールバックする', async () => {
  setApiKey('BYOK_KEY');
  setLicenseKey('LICENSE-1');
  const origin = { lat: 0, lng: 0 };
  const destination = { lat: 1, lng: 1 };
  const calledUrls = [];

  await withMockFetch(
    async (url) => {
      calledUrls.push(String(url));
      if (String(url).includes('/api/maps/routes')) throw new Error('backend down');
      return {
        ok: true,
        json: async () => ({
          routes: [{ polyline: { encodedPolyline: encodePolyline([origin, destination]) } }],
        }),
      };
    },
    async () => {
      const result = await fetchRoute(origin, destination);
      assert.equal(result.mode, 'BICYCLE');
    }
  );

  assert.ok(calledUrls.some((u) => u.includes('/api/maps/routes')));
  assert.ok(calledUrls.some((u) => u.includes('routes.googleapis.com')));
  setLicenseKey('');
  setApiKey('');
});

test('fetchRoute: サブスクがあってもバックエンド不通・BYOK無しならエラーになる', async () => {
  setApiKey('');
  setLicenseKey('LICENSE-1');

  await withMockFetch(
    async () => { throw new Error('backend down'); },
    () => assert.rejects(() => fetchRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }))
  );

  setLicenseKey('');
});

test('fetchElevations: サブスクがあればバックエンド経由で呼ぶ', async () => {
  setApiKey('');
  setLicenseKey('LICENSE-1');
  const path = buildPath([{ lat: 35.0, lng: 139.0 }, { lat: 35.001, lng: 139.0 }]);
  let capturedUrl = null;

  const elevations = await withMockFetch(
    async (url) => {
      capturedUrl = String(url);
      return { ok: true, json: async () => ({ status: 'OK', results: [{ elevation: 10 }, { elevation: 12 }] }) };
    },
    () => fetchElevations(path, 2)
  );

  assert.ok(capturedUrl.includes('/api/maps/elevation'), capturedUrl);
  assert.equal(elevations.length, path.points.length);
  setLicenseKey('');
});

test('fetchElevations: バックエンドが失敗しても BYOK があればフォールバックする', async () => {
  setApiKey('BYOK_KEY');
  setLicenseKey('LICENSE-1');
  const path = buildPath([{ lat: 35.0, lng: 139.0 }, { lat: 35.001, lng: 139.0 }]);
  const calledUrls = [];

  const elevations = await withMockFetch(
    async (url) => {
      calledUrls.push(String(url));
      if (String(url).includes('/api/maps/elevation')) return { ok: false, status: 500, text: async () => 'fail' };
      return { ok: true, json: async () => ({ status: 'OK', results: [{ elevation: 5 }, { elevation: 6 }] }) };
    },
    () => fetchElevations(path, 2)
  );

  assert.ok(calledUrls.some((u) => u.includes('/api/maps/elevation')));
  assert.ok(calledUrls.some((u) => u.includes('maps.googleapis.com/maps/api/elevation')));
  assert.equal(elevations.length, path.points.length);
  setLicenseKey('');
  setApiKey('');
});

test('fetchElevations: バックエンドも BYOK も無ければ空配列を返す', async () => {
  setApiKey('');
  setLicenseKey('');
  const path = buildPath([{ lat: 35.0, lng: 139.0 }, { lat: 35.001, lng: 139.0 }]);
  assert.deepEqual(await fetchElevations(path, 2), []);
});

/* ============ バックエンド（server/）: ライセンス確認・CORS ============ */

function fakeRes() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('withCors: 許可オリジン・メソッド・ヘッダーを設定する', () => {
  const res = fakeRes();
  withCors(res);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://kuzu-noha.github.io');
  assert.ok(res.headers['Access-Control-Allow-Methods'].includes('POST'));
  assert.ok(res.headers['Access-Control-Allow-Headers'].includes('X-Vcycling-License-Key'));
});

// テスト用の最小 Stripe クライアント。customers.retrieve / subscriptions.list だけ実装する
function fakeStripe({ metadata = {}, activeSubscriptions = [], onRetrieve, onList } = {}) {
  return {
    customers: {
      retrieve: async (id) => {
        onRetrieve?.(id);
        return { id, deleted: false, metadata };
      },
    },
    subscriptions: {
      list: async (params) => {
        onList?.(params);
        return { data: activeSubscriptions };
      },
    },
  };
}

test('isLicenseActive: キーが空なら false（Stripe に問い合わせない）', async () => {
  let called = false;
  const stripeImpl = fakeStripe({ onRetrieve: () => { called = true; } });
  const active = await isLicenseActive('', { stripeImpl, now: 0 });
  assert.equal(active, false);
  assert.ok(!called);
});

test('isLicenseActive: 形式が不正なキーは Stripe に問い合わせず false', async () => {
  let called = false;
  const stripeImpl = fakeStripe({ onRetrieve: () => { called = true; } });
  assert.equal(await isLicenseActive('not-a-valid-key', { stripeImpl, now: 0 }), false);
  assert.ok(!called);
});

test('isLicenseActive: ハッシュが一致しアクティブなサブスクがあれば true', async () => {
  clearLicenseCache();
  const token = 'ab'.repeat(32);
  const licenseKey = `vc_cus_TEST1_${token}`;
  let retrievedId = null;
  let listParams = null;
  const stripeImpl = fakeStripe({
    metadata: { vcycling_key_hash: hashToken(token) },
    activeSubscriptions: [{ id: 'sub_1' }],
    onRetrieve: (id) => { retrievedId = id; },
    onList: (params) => { listParams = params; },
  });
  assert.equal(await isLicenseActive(licenseKey, { stripeImpl, now: 1000 }), true);
  assert.equal(retrievedId, 'cus_TEST1');
  assert.equal(listParams.customer, 'cus_TEST1');
  assert.equal(listParams.status, 'active');
});

test('isLicenseActive: メタデータのハッシュが一致しなければ false', async () => {
  clearLicenseCache();
  const token = 'cd'.repeat(32);
  const licenseKey = `vc_cus_TEST2_${token}`;
  const stripeImpl = fakeStripe({ metadata: { vcycling_key_hash: 'wrong-hash' }, activeSubscriptions: [{ id: 'sub_1' }] });
  assert.equal(await isLicenseActive(licenseKey, { stripeImpl, now: 2000 }), false);
});

test('isLicenseActive: アクティブなサブスクリプションが無ければ false', async () => {
  clearLicenseCache();
  const token = 'ef'.repeat(32);
  const licenseKey = `vc_cus_TEST3_${token}`;
  const stripeImpl = fakeStripe({ metadata: { vcycling_key_hash: hashToken(token) }, activeSubscriptions: [] });
  assert.equal(await isLicenseActive(licenseKey, { stripeImpl, now: 3000 }), false);
});

test('isLicenseActive: Stripe呼び出しの例外は false 扱いにする', async () => {
  clearLicenseCache();
  const token = '12'.repeat(32);
  const licenseKey = `vc_cus_TEST4_${token}`;
  const stripeImpl = { customers: { retrieve: async () => { throw new Error('network down'); } } };
  assert.equal(await isLicenseActive(licenseKey, { stripeImpl, now: 4000 }), false);
});

test('isLicenseActive: 5分以内は再照会せずキャッシュを使う', async () => {
  clearLicenseCache();
  let calls = 0;
  const token = '34'.repeat(32);
  const licenseKey = `vc_cus_TEST5_${token}`;
  const stripeImpl = fakeStripe({
    metadata: { vcycling_key_hash: hashToken(token) },
    activeSubscriptions: [{ id: 'sub_1' }],
    onRetrieve: () => { calls++; },
  });
  const now = 10_000;
  assert.equal(await isLicenseActive(licenseKey, { stripeImpl, now }), true);
  assert.equal(await isLicenseActive(licenseKey, { stripeImpl, now: now + 60_000 }), true);
  assert.equal(calls, 1, 'キャッシュ有効期間内は Stripe に問い合わせないはず');
  assert.equal(await isLicenseActive(licenseKey, { stripeImpl, now: now + 6 * 60_000 }), true);
  assert.equal(calls, 2, '5分経過後は再照会するはず');
});

test('requireLicense: ヘッダー無しなら401を返し false になる', async () => {
  const res = fakeRes();
  const ok = await requireLicense({ headers: {} }, res);
  assert.equal(ok, false);
  assert.equal(res.statusCode, 401);
});

test('requireLicense: 無効なライセンスキーなら403を返し false になる', async () => {
  clearLicenseCache();
  const stripeImpl = fakeStripe({ activeSubscriptions: [] });
  const res = fakeRes();
  const ok = await requireLicense({ headers: { 'x-vcycling-license-key': 'BAD' } }, res, { stripeImpl });
  assert.equal(ok, false);
  assert.equal(res.statusCode, 403);
});

test('requireLicense: 有効なライセンスキーなら true を返しレスポンスに触れない', async () => {
  clearLicenseCache();
  const token = '56'.repeat(32);
  const licenseKey = `vc_cus_TEST6_${token}`;
  const stripeImpl = fakeStripe({
    metadata: { vcycling_key_hash: hashToken(token) },
    activeSubscriptions: [{ id: 'sub_1' }],
  });
  const res = fakeRes();
  const ok = await requireLicense({ headers: { 'x-vcycling-license-key': licenseKey } }, res, { stripeImpl });
  assert.equal(ok, true);
  assert.equal(res.statusCode, null);
});

/* ============ 2Dフォールバックの背景地図投影（Web Mercator） ============ */

test('latLngToWorldPoint: 赤道・経度0はタイルの中心になる', () => {
  const p = latLngToWorldPoint(0, 0);
  assert.ok(Math.abs(p.x - 128) < 1e-9, `x: ${p.x}`);
  assert.ok(Math.abs(p.y - 128) < 1e-9, `y: ${p.y}`);
});

test('latLngToWorldPoint: 経度180/-180はタイルの右端/左端になる', () => {
  assert.ok(Math.abs(latLngToWorldPoint(0, 180).x - 256) < 1e-9);
  assert.ok(Math.abs(latLngToWorldPoint(0, -180).x - 0) < 1e-9);
});

test('latLngToWorldPoint: 北半球ほどyが小さくなる（上に行く）', () => {
  const equator = latLngToWorldPoint(0, 0);
  const north = latLngToWorldPoint(45, 0);
  const south = latLngToWorldPoint(-45, 0);
  assert.ok(north.y < equator.y && equator.y < south.y);
});

test('zoomForBounds: 狭い範囲ほど大きいズームになる', () => {
  const narrow = { minLat: 35.68, maxLat: 35.681, minLng: 139.76, maxLng: 139.761 };
  const wide = { minLat: 30, maxLat: 40, minLng: 130, maxLng: 145 };
  const zNarrow = zoomForBounds(narrow, 640, 640);
  const zWide = zoomForBounds(wide, 640, 640);
  assert.ok(zNarrow > zWide, `狭い ${zNarrow} / 広い ${zWide}`);
});

test('zoomForBounds: maxZoom を超えない', () => {
  const tiny = { minLat: 35.6800, maxLat: 35.68001, minLng: 139.76, maxLng: 139.76001 };
  assert.ok(zoomForBounds(tiny, 640, 640, 20) <= 20);
});

test('zoomForBounds: 0未満にはならない', () => {
  const huge = { minLat: -85, maxLat: 85, minLng: -179, maxLng: 179 };
  assert.ok(zoomForBounds(huge, 100, 100) >= 0);
});

/* ============ FTMS: Indoor Bike Data ============ */

/** フラグとフィールドからテスト用のバイト列を組み立てる */
function buildIndoorBikeData(flags, fields) {
  const bytes = [flags & 0xff, (flags >> 8) & 0xff, ...fields];
  return new DataView(new Uint8Array(bytes).buffer);
}

test('Indoor Bike Data: bit0=0 のとき瞬間速度が存在する（論理反転）', () => {
  // flags=0x0000 → More Data が 0 なので速度あり。3000 * 0.01 = 30.00 km/h
  const view = buildIndoorBikeData(0x0000, [0xb8, 0x0b]);
  const d = parseIndoorBikeData(view);
  assert.equal(d.speedKmh, 30);
});

test('Indoor Bike Data: bit0=1 のとき瞬間速度は存在しない', () => {
  // flags=0x0005 → bit0=1（速度なし）, bit2=1（ケイデンスあり）
  // ケイデンスが先頭に来る。180 * 0.5 = 90 rpm
  const view = buildIndoorBikeData(0x0005, [0xb4, 0x00]);
  const d = parseIndoorBikeData(view);
  assert.equal(d.speedKmh, undefined);
  assert.equal(d.cadenceRpm, 90);
});

test('Indoor Bike Data: 速度+ケイデンス+パワーの複合ケース', () => {
  // flags: bit0=0(速度あり), bit2(ケイデンス), bit6(パワー) → 0x0044
  const view = buildIndoorBikeData(0x0044, [
    0xb8, 0x0b,  // 速度 3000 → 30.00 km/h
    0xb4, 0x00,  // ケイデンス 180 → 90 rpm
    0xfa, 0x00,  // パワー 250 W
  ]);
  const d = parseIndoorBikeData(view);
  assert.equal(d.speedKmh, 30);
  assert.equal(d.cadenceRpm, 90);
  assert.equal(d.powerW, 250);
});

test('Indoor Bike Data: 全フィールドを順序どおり読み出せる', () => {
  const flags = 0x1ffe | 0x0000; // bit0=0(速度あり) + bit1〜bit12 すべて立てる
  const view = buildIndoorBikeData(flags, [
    0xb8, 0x0b,        // 瞬間速度 30.00 km/h
    0x88, 0x13,        // 平均速度 5000 → 50.00 km/h
    0xb4, 0x00,        // 瞬間ケイデンス 90 rpm
    0x64, 0x00,        // 平均ケイデンス 50 rpm
    0xe8, 0x03, 0x00,  // 総距離 uint24 = 1000 m
    0x05, 0x00,        // 抵抗レベル 5
    0xfa, 0x00,        // 瞬間パワー 250 W
    0xc8, 0x00,        // 平均パワー 200 W
    0x2c, 0x01,        // 総エネルギー 300 kcal
    0x90, 0x01,        // 時間あたり 400 kcal
    0x07,              // 分あたり 7 kcal
    0x8c,              // 心拍 140 bpm
    0x46,              // MET 70 → 7.0
    0x3c, 0x00,        // 経過 60 秒
    0x1e, 0x00,        // 残り 30 秒
  ]);
  const d = parseIndoorBikeData(view);
  assert.equal(d.speedKmh, 30);
  assert.equal(d.avgSpeedKmh, 50);
  assert.equal(d.cadenceRpm, 90);
  assert.equal(d.avgCadenceRpm, 50);
  assert.equal(d.totalDistanceM, 1000);
  assert.equal(d.resistanceLevel, 5);
  assert.equal(d.powerW, 250);
  assert.equal(d.avgPowerW, 200);
  assert.equal(d.totalEnergyKcal, 300);
  assert.equal(d.energyPerHourKcal, 400);
  assert.equal(d.energyPerMinuteKcal, 7);
  assert.equal(d.heartRateBpm, 140);
  assert.ok(Math.abs(d.metabolicEquivalent - 7) < 1e-9);
  assert.equal(d.elapsedTimeS, 60);
  assert.equal(d.remainingTimeS, 30);
});

test('Indoor Bike Data: uint24 の総距離を正しく組み立てる', () => {
  // bit0=1(速度なし) + bit4(総距離) = 0x0011。0x010000 = 65536 m
  const view = buildIndoorBikeData(0x0011, [0x00, 0x00, 0x01]);
  assert.equal(parseIndoorBikeData(view).totalDistanceM, 65536);
});

test('Indoor Bike Data: 負のパワー（下り）を sint16 として読む', () => {
  const view = buildIndoorBikeData(0x0041, [0xf6, 0xff]); // -10 W
  assert.equal(parseIndoorBikeData(view).powerW, -10);
});

/* ============ FTMS: Control Point ============ */

test('buildSimulationCommand: 勾配 5% を仕様どおりエンコードする', () => {
  const buf = buildSimulationCommand({ gradePercent: 5 });
  const v = new DataView(buf);
  assert.equal(buf.byteLength, 7);
  assert.equal(v.getUint8(0), 0x11);          // オペコード
  assert.equal(v.getInt16(1, true), 0);        // 風速 0
  assert.equal(v.getInt16(3, true), 500);      // 5% ÷ 0.01 = 500
  assert.equal(v.getUint8(5), 40);             // crr 0.004 ÷ 0.0001 = 40
  assert.equal(v.getUint8(6), 51);             // cw 0.51 ÷ 0.01 = 51
});

test('buildSimulationCommand: 下り勾配を負値としてエンコードする', () => {
  const v = new DataView(buildSimulationCommand({ gradePercent: -7.5 }));
  assert.equal(v.getInt16(3, true), -750);
});

test('buildSimulationCommand: uint8 の範囲を超える係数は飽和させる', () => {
  const v = new DataView(buildSimulationCommand({ crr: 1, cw: 10 }));
  assert.equal(v.getUint8(5), 255);
  assert.equal(v.getUint8(6), 255);
});

test('parseFeatureFlags: 対応機能ビットを読み出す', () => {
  const bytes = new Uint8Array(8);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, (1 << 1) | (1 << 14), true); // ケイデンス + パワー
  v.setUint32(4, 1 << 13, true);              // シミュレーション対応
  const f = parseFeatureFlags(v);
  assert.equal(f.cadence, true);
  assert.equal(f.power, true);
  assert.equal(f.simulation, true);
  assert.equal(f.resistanceLevel, false);
});

/* ============ CSC (0x1816) ============ */

test('CSC: ホイールとクランクの両方を読み出す', () => {
  // flags=0x03（両方あり）
  const bytes = new Uint8Array([
    0x03,
    0x10, 0x00, 0x00, 0x00,  // 累積ホイール回転 16
    0x00, 0x04,              // ホイールイベント時刻 1024 (=1秒)
    0x20, 0x00,              // 累積クランク回転 32
    0x00, 0x08,              // クランクイベント時刻 2048 (=2秒)
  ]);
  const d = parseCscMeasurement(new DataView(bytes.buffer));
  assert.equal(d.cumulativeWheelRevs, 16);
  assert.equal(d.lastWheelEventTime, 1024);
  assert.equal(d.cumulativeCrankRevs, 32);
  assert.equal(d.lastCrankEventTime, 2048);
});

test('CSC: クランクのみの機種を正しく読む（ホイール分ずれない）', () => {
  const bytes = new Uint8Array([0x02, 0x20, 0x00, 0x00, 0x04]);
  const d = parseCscMeasurement(new DataView(bytes.buffer));
  assert.equal(d.cumulativeWheelRevs, undefined);
  assert.equal(d.cumulativeCrankRevs, 32);
  assert.equal(d.lastCrankEventTime, 1024);
});

/* ============ Cycling Power (0x1818) ============ */

test('Cycling Power: パワーのみ（フラグ0）を読む', () => {
  const bytes = new Uint8Array([0x00, 0x00, 0xfa, 0x00]); // 250 W
  const d = parseCyclingPowerMeasurement(new DataView(bytes.buffer));
  assert.equal(d.powerW, 250);
});

test('Cycling Power: パワー + クランク回転（ケイデンス取得の主経路）', () => {
  // flags bit5 = クランク回転データあり
  const bytes = new Uint8Array([
    0x20, 0x00,        // flags
    0xfa, 0x00,        // 250 W
    0x40, 0x00,        // 累積クランク回転 64
    0x00, 0x04,        // クランクイベント時刻 1024
  ]);
  const d = parseCyclingPowerMeasurement(new DataView(bytes.buffer));
  assert.equal(d.powerW, 250);
  assert.equal(d.cumulativeCrankRevs, 64);
  assert.equal(d.lastCrankEventTime, 1024);
});

test('Cycling Power: ホイール+クランク両方でもオフセットがずれない', () => {
  // flags bit4 + bit5
  const bytes = new Uint8Array([
    0x30, 0x00,
    0xc8, 0x00,                    // 200 W
    0x0a, 0x00, 0x00, 0x00,        // ホイール回転 10 (uint32)
    0x00, 0x08,                    // ホイールイベント時刻 2048
    0x14, 0x00,                    // クランク回転 20
    0x00, 0x04,                    // クランクイベント時刻 1024
  ]);
  const d = parseCyclingPowerMeasurement(new DataView(bytes.buffer));
  assert.equal(d.powerW, 200);
  assert.equal(d.cumulativeWheelRevs, 10);
  assert.equal(d.lastWheelEventTime, 2048);
  assert.equal(d.cumulativeCrankRevs, 20);
  assert.equal(d.lastCrankEventTime, 1024);
});

test('Cycling Power: 前方に可変長フィールドがあってもクランクを正しく読む', () => {
  // bit0(バランス) + bit2(トルク) + bit5(クランク)
  const bytes = new Uint8Array([
    0x25, 0x00,
    0xfa, 0x00,        // 250 W
    0x64,              // バランス 100 → 50%
    0x00, 0x02,        // 累積トルク
    0x40, 0x00,        // クランク回転 64
    0x00, 0x04,        // 時刻 1024
  ]);
  const d = parseCyclingPowerMeasurement(new DataView(bytes.buffer));
  assert.equal(d.powerW, 250);
  assert.equal(d.pedalPowerBalance, 50);
  assert.equal(d.cumulativeCrankRevs, 64);
});

/* ============ Wahoo 独自トレーナー制御 ============ */

test('Wahoo: 解除コマンド', () => {
  assert.deepEqual([...buildUnlockCommand()], [0x20, 0xee, 0xfc]);
});

test('Wahoo: 勾配0%は中央値になる', () => {
  // 仕様: (grade + 1.0) × 65535 ÷ 2。勾配0 なら 32767.5 → 32768
  const cmd = buildSimGradeCommand(0);
  assert.equal(cmd[0], 0x46);
  const value = cmd[1] | (cmd[2] << 8);
  assert.equal(value, 32768);
});

test('Wahoo: 上り勾配は中央値より大きく、下りは小さくなる', () => {
  const climb = buildSimGradeCommand(5);
  const descent = buildSimGradeCommand(-5);
  const v = (c) => c[1] | (c[2] << 8);
  assert.ok(v(climb) > 32768, `上り: ${v(climb)}`);
  assert.ok(v(descent) < 32768, `下り: ${v(descent)}`);
  // 5% は 0.05 → (1.05 × 65535) / 2 = 34406
  assert.equal(v(climb), 34406);
});

test('Wahoo: 安全のため勾配を ±15% に丸める', () => {
  const v = (c) => c[1] | (c[2] << 8);
  // 想定外の値が来ても負荷が跳ね上がらないこと
  assert.equal(v(buildSimGradeCommand(999)), v(buildSimGradeCommand(15)));
  assert.equal(v(buildSimGradeCommand(-999)), v(buildSimGradeCommand(-15)));
});

test('Wahoo: SIM モードの前提条件をエンコードする', () => {
  const cmd = buildSimModeCommand(80, 0.004, 0.51);
  assert.equal(cmd[0], 0x43);
  assert.equal(cmd.length, 7);
  assert.equal(cmd[1] | (cmd[2] << 8), 8000);  // 体重 80kg × 100
  assert.equal(cmd[3] | (cmd[4] << 8), 4);     // crr 0.004 × 1000
  assert.equal(cmd[5] | (cmd[6] << 8), 510);   // cwr 0.51 × 1000
});

test('Wahoo: ERG モードの目標パワー', () => {
  const cmd = buildErgCommand(250);
  assert.equal(cmd[0], 0x42);
  assert.equal(cmd[1] | (cmd[2] << 8), 250);
});

/* ============ 走行物理 ============ */

test('speedFromPower: 平地 200W で 30km/h 前後になる', () => {
  const kmh = speedFromPower(200, 0, 80);
  assert.ok(kmh > 26 && kmh < 34, `実際: ${kmh}`);
});

test('speedFromPower: 同じパワーでも上り坂では遅くなる', () => {
  const flat = speedFromPower(200, 0, 80);
  const climb = speedFromPower(200, 5, 80);
  assert.ok(climb < flat / 2, `平地 ${flat} / 5%坂 ${climb}`);
});

test('speedFromPower: 5%勾配の登坂速度が実走と整合する', () => {
  // 総重量80kg・200W（2.5 W/kg）・5%勾配。
  // 登坂の目安 VAM ≒ (W/kg) × 352 m/h から水平速度は 17km/h 前後で、
  // 空気抵抗を含めると 15km/h 台に落ちる。
  const kmh = speedFromPower(200, 5, 80);
  assert.ok(kmh > 13 && kmh < 18, `実際: ${kmh}`);
});

test('speedFromPower: 平地の速度が実走と整合する', () => {
  // 200W で 32〜35km/h（CdA 0.32 のロードバイク相当）
  const kmh = speedFromPower(200, 0, 80);
  assert.ok(kmh > 31 && kmh < 36, `実際: ${kmh}`);
});

test('speedFromPower: 重い人ほど登坂は遅く、平地では差が小さい', () => {
  const lightClimb = speedFromPower(200, 5, 65);
  const heavyClimb = speedFromPower(200, 5, 95);
  assert.ok(lightClimb > heavyClimb, `軽 ${lightClimb} / 重 ${heavyClimb}`);

  const lightFlat = speedFromPower(200, 0, 65);
  const heavyFlat = speedFromPower(200, 0, 95);
  assert.ok(Math.abs(lightFlat - heavyFlat) < 2, `軽 ${lightFlat} / 重 ${heavyFlat}`);
});

test('BIKE_PROFILES: 速い車種ほど同じ出力で速く走れる', () => {
  const at150W = (key) => {
    const p = profileFor(key);
    return speedFromPower(150, 0, 80, { cda: p.cda, crr: p.crr });
  };
  const tt = at150W('tt');
  const road = at150W('road');
  const cross = at150W('cross');
  const city = at150W('city');

  assert.ok(tt > road && road > cross && cross > city,
    `TT ${tt} > ロード ${road} > クロス ${cross} > シティ ${city}`);
  // 表示している目安値と実際の計算が一致していること
  for (const key of Object.keys(BIKE_PROFILES)) {
    const actual = at150W(key);
    const claimed = BIKE_PROFILES[key].approxKmhAt150W;
    assert.ok(Math.abs(actual - claimed) < 1.5,
      `${key}: 表示 ${claimed} / 実際 ${actual.toFixed(1)}`);
  }
});

test('profileFor: 未知のキーはロードバイクにフォールバックする', () => {
  assert.equal(profileFor('unknown'), BIKE_PROFILES.road);
  assert.equal(profileFor(undefined), BIKE_PROFILES.road);
});

test('trainerWindResistance: ロードバイクは基準値(0.51)そのまま', () => {
  assert.ok(Math.abs(trainerWindResistance('road') - 0.51) < 1e-9);
});

test('trainerWindResistance: 速い車種ほど値が小さく、遅い車種ほど大きい', () => {
  const tt = trainerWindResistance('tt');
  const road = trainerWindResistance('road');
  const cross = trainerWindResistance('cross');
  const city = trainerWindResistance('city');
  assert.ok(tt < road && road < cross && cross < city,
    `TT ${tt} < ロード ${road} < クロス ${cross} < シティ ${city}`);
});

test('trainerWindResistance: FTMS/Wahoo の uint8 表現(×0.01, 最大255)に収まる', () => {
  for (const key of Object.keys(BIKE_PROFILES)) {
    const cw = trainerWindResistance(key);
    assert.ok(cw > 0 && cw / 0.01 <= 255, `${key}: ${cw}`);
  }
});

test('speedFromPower: パワー0や不正値では 0', () => {
  assert.equal(speedFromPower(0, 0, 80), 0);
  assert.equal(speedFromPower(-50, 0, 80), 0);
  assert.equal(speedFromPower(NaN, 0, 80), 0);
});

test('powerRequired: 登坂ぶんのパワーが加算される', () => {
  const flat = powerRequired(8, 0, 80);
  const climb = powerRequired(8, 5, 80);
  assert.ok(climb > flat, `平地 ${flat} / 坂 ${climb}`);
});

test('RevolutionCounter: 回転数/秒を算出する', () => {
  const c = new RevolutionCounter({ timeResolution: 1024 });
  assert.equal(c.update(0, 0), null);           // 初回は基準を取るだけ
  const rps = c.update(10, 1024);               // 1秒で10回転
  assert.ok(Math.abs(rps - 10) < 0.001, `実際: ${rps}`);
});

test('RevolutionCounter: 測定窓が短すぎるうちは値を跳ねさせない', () => {
  // 通知間隔が 10ms で回転1回だと、素朴に割ると毎秒100回転になってしまう。
  // これが「速度が異常な値になる」原因なので、窓がたまるまで保持する。
  const c = new RevolutionCounter({ timeResolution: 1024, minIntervalSec: 0.5 });
  c.update(0, 0);
  assert.equal(c.update(1, 10), null, '窓が足りない間は前回値（初回は null）');
  assert.equal(c.update(2, 20), null);
  // 0.5秒を超えたところで初めて算出する（累積 使用: 512/1024 = 0.5秒で 5回転）
  const rps = c.update(5, 512);
  assert.ok(Math.abs(rps - 10) < 0.01, `実際: ${rps}`);
});

test('RevolutionCounter: 算出後は次の窓がたまるまで直前値を保持する', () => {
  const c = new RevolutionCounter({ timeResolution: 1024, minIntervalSec: 0.5 });
  c.update(0, 0);
  const first = c.update(10, 1024);
  assert.ok(Math.abs(first - 10) < 0.01);
  // すぐ次の通知が来ても値が暴れない
  assert.equal(c.update(11, 1034), first);
});

test('RevolutionCounter: uint16 の時刻巻き戻りを補正する', () => {
  const c = new RevolutionCounter({ timeResolution: 1024 });
  c.update(0, 65000);
  // 65000 → 512 は巻き戻り。実際は (65536-65000+512)/1024 ≒ 1.03 秒
  const rps = c.update(10, 512);
  assert.ok(rps > 9 && rps < 11, `実際: ${rps}`);
});

test('RevolutionCounter: 時刻が進まない再通知では null を返す', () => {
  const c = new RevolutionCounter({ timeResolution: 1024 });
  c.update(10, 1024);
  assert.equal(c.update(10, 1024), null);
});

test('RevolutionCounter: 停止が続けば 0 を返す', () => {
  const c = new RevolutionCounter({ timeResolution: 1024 });
  c.update(10, 1024);
  let last = null;
  for (let i = 0; i < 10; i++) last = c.update(10, 1024);
  assert.equal(last, 0);
});

test('speedFromWheel: 周長 2105mm で毎秒5回転なら約37.9km/h', () => {
  const kmh = speedFromWheel(5, 2105);
  assert.ok(Math.abs(kmh - 37.89) < 0.1, `実際: ${kmh}`);
  assert.equal(speedFromWheel(null, 2105), null);
});

test('cadenceFromCrank: 毎秒1.5回転なら 90rpm', () => {
  assert.equal(cadenceFromCrank(1.5), 90);
  assert.equal(cadenceFromCrank(null), null);
});

/* ============ 平滑化と外れ値の除去 ============ */

test('Smoother: 初回はそのまま、以降は徐々に追従する', () => {
  const s = new Smoother(2.0);
  assert.equal(s.update(30, 0), 30);
  // 1秒後に 0 が来ても一気に 0 にはならない
  const after = s.update(0, 1000);
  assert.ok(after > 0 && after < 30, `実際: ${after}`);
});

test('Smoother: 時間が経つほど新しい値へ強く追従する', () => {
  const quick = new Smoother(2.0);
  quick.update(0, 0);
  const shortStep = quick.update(100, 200);   // 0.2秒後

  const slow = new Smoother(2.0);
  slow.update(0, 0);
  const longStep = slow.update(100, 5000);    // 5秒後

  assert.ok(longStep > shortStep, `0.2秒: ${shortStep} / 5秒: ${longStep}`);
  assert.ok(longStep > 90, `5秒後はほぼ追いつく: ${longStep}`);
});

test('Smoother: 平滑化だけでは大きな外れ値に引きずられる（変化率制限が要る根拠）', () => {
  const s = new Smoother(2.5); // 変化率制限なし
  for (let t = 0; t < 5; t++) s.update(25, t * 1000);
  const v = s.update(300, 5200);
  assert.ok(v > 100, `平滑化のみだと ${v} まで跳ねる`);
});

test('Smoother: 変化率制限があれば単発スパイクが表示を支配しない', () => {
  const s = new Smoother(2.5, 10); // 10 km/h/秒（実機の設定と同じ）
  s.update(25, 0);
  s.update(25, 1000);
  // 直前の更新から 0.2秒後にノイズ 300km/h が1回混ざっても、
  // 増分は 10 × 0.2 = 2km/h までに抑えられる
  const v = s.update(300, 1200);
  assert.ok(v <= 27.01, `実際: ${v}`);
});

test('Smoother: 変化率制限は正常な加減速を妨げない', () => {
  const s = new Smoother(0.5, 10);
  s.update(20, 0);
  // 3秒かけて 20→30km/h（毎秒3.3km/h）は実走で普通に起こる。追随できること
  let v = 20;
  for (let t = 1; t <= 6; t++) v = s.update(30, t * 500);
  assert.ok(v > 29, `実際: ${v}`);
});

test('Smoother: 減速側にも変化率制限が効く', () => {
  const s = new Smoother(2.5, 10);
  s.update(30, 0);
  s.update(30, 1000);
  const v = s.update(0, 1200); // 0.2秒で急停止の値が来た
  assert.ok(v >= 27.99, `実際: ${v}`);
});

test('Smoother: 不正な値は無視して直前値を保つ', () => {
  const s = new Smoother(2.0);
  s.update(25, 0);
  assert.equal(s.update(NaN, 1000), 25);
});

test('isPlausibleSpeed: 現実にありえない速度を弾く', () => {
  assert.equal(isPlausibleSpeed(30), true);
  assert.equal(isPlausibleSpeed(0), true);
  assert.equal(isPlausibleSpeed(500), false);   // 内部カウントを誤って換算した値
  assert.equal(isPlausibleSpeed(-5), false);
  assert.equal(isPlausibleSpeed(NaN), false);
});

test('isPlausibleCadence: 現実にありえないケイデンスを弾く', () => {
  assert.equal(isPlausibleCadence(90), true);
  assert.equal(isPlausibleCadence(400), false);
  assert.equal(isPlausibleCadence(-1), false);
});

/* ============ 心拍 ============ */

test('parseHeartRate: 8bit / 16bit の両形式に対応する', () => {
  const v8 = new DataView(new Uint8Array([0x00, 0x8c]).buffer);
  assert.equal(parseHeartRate(v8).heartRateBpm, 140);

  const v16 = new DataView(new Uint8Array([0x01, 0x2c, 0x01]).buffer);
  assert.equal(parseHeartRate(v16).heartRateBpm, 300);
});

/* ============ カロリー ============ */

test('kcalFromPower: 200W × 60秒 = 12 kJ ≒ 12 kcal', () => {
  assert.equal(kcalFromPower(200, 60), 12);
});

test('kcalFromPower: 1時間 250W なら約900kcal（実走の感覚と一致する）', () => {
  const kcal = kcalFromPower(250, 3600);
  assert.equal(kcal, 900);
});

test('kcalFromPower: 不正値は 0 を返す', () => {
  assert.equal(kcalFromPower(0, 60), 0);
  assert.equal(kcalFromPower(NaN, 60), 0);
  assert.equal(kcalFromPower(200, 0), 0);
});

test('kcalFromMet: 7METs × 70kg × 1時間 ≒ 515 kcal', () => {
  const kcal = kcalFromMet(7, 70, 3600);
  assert.ok(Math.abs(kcal - 514.5) < 0.1, `実際: ${kcal}`);
});

test('estimateMet: 速度から強度を段階的に見積もる', () => {
  assert.equal(estimateMet({ speedKmh: 0, cadenceRpm: 0 }), 0);
  assert.equal(estimateMet({ speedKmh: 12 }), 5.5);
  assert.equal(estimateMet({ speedKmh: 20 }), 7.0);
  assert.equal(estimateMet({ speedKmh: 30 }), 10.5);
});

test('zoneFor: 脂肪燃焼ゾーン(Z2)を判定できる', () => {
  const age = 40;                     // 最大心拍 180
  assert.equal(maxHeartRate(age), 180);
  assert.equal(zoneFor(117, age).key, 'z2');   // 65%
  assert.equal(zoneFor(135, age).key, 'z3');   // 75%
  assert.equal(zoneFor(0, age), null);
});

test('CalorieAccumulator: パワーが来たら推定から実測へ切り替わる', () => {
  const acc = new CalorieAccumulator({ weightKg: 70 });
  acc.add({ speedKmh: 20, cadenceRpm: 80 }, 60);
  assert.equal(acc.method, 'met');
  assert.ok(acc.isEstimate);
  const afterMet = acc.kcal;
  assert.ok(afterMet > 0);

  acc.add({ powerW: 200, speedKmh: 20 }, 60);
  assert.equal(acc.method, 'power');
  assert.equal(acc.isEstimate, false);
  // MET ぶんは破棄されず引き継がれる
  assert.ok(acc.kcal > afterMet);
  assert.equal(acc.kj, 12);
});

/* ============ 走行エンジン ============ */

function makeStubSource() {
  const src = new EventTarget();
  src.supportsGrade = true;
  src.grades = [];
  src.setGrade = (g) => { src.grades.push(g); return Promise.resolve(true); };
  src.pause = () => {};
  src.resume = () => {};
  return src;
}

test('RideEngine: 速度から距離を積算する', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.1, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });

  engine.live.speedKmh = 36; // = 10 m/s
  engine.advance(1);
  assert.ok(Math.abs(engine.distanceM - 10) < 0.001, `実際: ${engine.distanceM}`);

  engine.advance(2);
  assert.ok(Math.abs(engine.distanceM - 30) < 0.001);
  assert.ok(Math.abs(engine.elapsedSec - 3) < 0.001);
});

test('RideEngine: 速度の倍率が距離に反映される', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.1, lng: 139 }]);
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [], speedMultiplier: 2,
  });
  engine.live.speedKmh = 36;
  engine.advance(1);
  assert.ok(Math.abs(engine.distanceM - 20) < 0.001, `実際: ${engine.distanceM}`);
});

test('RideEngine: 倍率は表示速度にも掛かり、距離と一致する', () => {
  // 速度計が実測のまま、距離だけ倍になると辻褄が合わない。
  // 表示・景色・距離の3つが同じ速度で動くこと。
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.5, lng: 139 }]);
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [], speedMultiplier: 1.5,
  });
  engine.live.speedKmh = 20;
  engine.advance(10);

  const s = engine.snapshot();
  assert.equal(s.speedKmh, 30);        // 20 × 1.5
  assert.equal(s.rawSpeedKmh, 20);     // 実測値も参照できる
  assert.equal(s.speedMultiplier, 1.5);
  // 30km/h で10秒 = 83.3m
  assert.ok(Math.abs(engine.distanceM - (30 / 3.6) * 10) < 0.001,
    `実際: ${engine.distanceM}`);
});

test('RideEngine: 倍率1のときは表示と実測が一致する', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.5, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.live.speedKmh = 25;
  engine.advance(1);
  const s = engine.snapshot();
  assert.equal(s.speedKmh, s.rawSpeedKmh);
});

test('RideEngine: 最大速度も倍率を掛けた値で記録する', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [], speedMultiplier: 2,
  });
  engine.live.speedKmh = 20;
  engine.advance(1);
  assert.equal(engine.summary().maxSpeedKmh, 40);
});

test('RideEngine: 勾配は初回は生の値をそのまま使う', () => {
  // Smoother は初回呼び出しではならさずそのまま返す。突然の急坂の
  // 検知が1フレーム分遅れるだけで済むようにするための仕様
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.01, lng: 139 }]);
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [0, 100],
  });
  engine.live.speedKmh = 36;
  engine.advance(1);
  const raw = gradeAt(path, [0, 100], engine.distanceM);
  assert.ok(Math.abs(engine.grade - raw) < 0.01, `平滑化前 ${raw} / 実際 ${engine.grade}`);
});

test('RideEngine: 勾配の急変を1秒あたりの上限で抑える', () => {
  // 平坦(0%)から突然25%勾配の区間に切り替わるような不自然な標高データでも、
  // 1フレーム目で満額反映せず、変化率の上限に沿ってならされること
  const path = buildPath([
    { lat: 35, lng: 139 }, { lat: 35.001, lng: 139 }, { lat: 35.002, lng: 139 },
  ]);
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [0, 0, 60],
  });
  engine.live.speedKmh = 36;
  engine.advance(2); // 1回目: ここで基準値が決まる
  const first = engine.grade;
  engine.advance(0.1); // 2回目: 0.1秒後の微小な変化
  const second = engine.grade;
  // 変化率上限(6%/秒)を大きく超える飛びにはならないこと
  assert.ok(Math.abs(second - first) <= 6 * 0.1 + 0.5,
    `1回目 ${first} → 2回目 ${second}`);
});

test('RideEngine: 勾配をデータ源へ送る', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.01, lng: 139 }]);
  const source = makeStubSource();
  const engine = new RideEngine({ path, source, elevations: [0, 100] });
  engine.live.speedKmh = 36;
  engine.advance(1);
  assert.ok(source.grades.length > 0);
  assert.ok(source.grades[0] > 5, `実際: ${source.grades[0]}`);
});

test('RideEngine: 勾配連動を切ると送信しない', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.01, lng: 139 }]);
  const source = makeStubSource();
  const engine = new RideEngine({
    path, source, elevations: [0, 100], gradeEnabled: false,
  });
  engine.live.speedKmh = 36;
  engine.advance(1);
  assert.equal(source.grades.length, 0);
});

test('RideEngine: パワーからカロリーを積算する', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.live.powerW = 200;
  engine.live.speedKmh = 25;
  engine.advance(60);
  assert.ok(Math.abs(engine.calories.kcal - 12) < 0.001, `実際: ${engine.calories.kcal}`);
  assert.equal(engine.snapshot().calorieIsEstimate, false);
});

test('RideEngine: 終点に到達すると完走扱いになる', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.001, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  let finished = null;
  engine.addEventListener('finish', (e) => { finished = e.detail; });

  engine.live.speedKmh = 72; // 20 m/s
  engine.advance(60);        // 経路長(約111m)を大きく超える

  assert.equal(engine.state, 'finished');
  assert.equal(engine.distanceM, path.totalDistanceM);
  assert.ok(finished, '完走イベントが発火していない');
  assert.equal(finished.distanceM, Math.round(path.totalDistanceM));
});

test('RideEngine: loop 指定なら終点で先頭へ戻る', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.001, lng: 139 }]);
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [], loop: true,
  });
  engine.live.speedKmh = 72;
  engine.advance(60);
  assert.notEqual(engine.state, 'finished');
  assert.ok(engine.distanceM < path.totalDistanceM);
});

test('RideEngine: 心拍ゾーンの滞在時間を積算する', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [], age: 40,
  });
  engine.live.heartRateBpm = 117; // Z2
  engine.live.speedKmh = 20;
  engine.advance(10);
  assert.ok(Math.abs(engine.zoneSeconds.z2 - 10) < 0.001);
  assert.equal(engine.zoneSeconds.z4, 0);
});

test('RideEngine: 平均値と要約を算出する', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.startedAt = new Date('2026-01-01T00:00:00Z');

  engine.live.powerW = 100;
  engine.live.speedKmh = 20;
  engine.advance(10);
  engine.live.powerW = 300;
  engine.advance(10);

  assert.ok(Math.abs(engine.avgPowerW - 200) < 0.001, `実際: ${engine.avgPowerW}`);
  const s = engine.summary();
  assert.equal(s.maxPowerW, 300);
  assert.equal(s.avgPowerW, 200);
  assert.ok(s.distanceM > 0);
  assert.equal(typeof s.startedAt, 'string');
});

test('RideEngine: 一定距離ごとに distanceLog を記録する', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.1, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.live.speedKmh = 36; // 10 m/s
  for (let i = 0; i < 10; i++) engine.advance(1); // 合計100m進む

  assert.ok(engine.distanceLog.length >= 3, `記録数: ${engine.distanceLog.length}`);
  assert.equal(engine.distanceLog[0].distanceM, 0);
  // 単調増加であること（ゴースト補間の前提）
  for (let i = 1; i < engine.distanceLog.length; i++) {
    assert.ok(engine.distanceLog[i].distanceM >= engine.distanceLog[i - 1].distanceM);
  }
});

test('RideEngine: ゴーストより速いと ghostDeltaSec が負になる', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.1, lng: 139 }]); // 約11.1km
  const ghost = {
    distanceLog: [
      { distanceM: 0, elapsedSec: 0 },
      { distanceM: 11100, elapsedSec: 1000 },
    ],
  };
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [], ghost });
  engine.live.speedKmh = 3600; // 極端に速く走り、同距離を短時間で通過させる
  engine.advance(3); // 3000m 相当

  assert.ok(engine.ghostDeltaSec < 0, `実際: ${engine.ghostDeltaSec}`);
  assert.equal(engine.snapshot().hasGhost, true);
});

test('RideEngine: ゴーストより遅いと ghostDeltaSec が正になる', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.1, lng: 139 }]);
  const ghost = {
    distanceLog: [
      { distanceM: 0, elapsedSec: 0 },
      { distanceM: 11100, elapsedSec: 100 }, // ゴーストは非常に速い
    ],
  };
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [], ghost });
  engine.live.speedKmh = 3.6; // 1 m/s とゆっくり
  engine.advance(1000); // 1000m 相当（十分ゴーストより遅い）

  assert.ok(engine.ghostDeltaSec > 0, `実際: ${engine.ghostDeltaSec}`);
});

test('RideEngine: ゴーストが無ければ hasGhost=false, ghostDeltaSec=null', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.live.speedKmh = 20;
  engine.advance(5);
  const s = engine.snapshot();
  assert.equal(s.hasGhost, false);
  assert.equal(s.ghostDeltaSec, null);
});

test('RideEngine: loop ルートではゴーストが渡されても無効化される', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const ghost = { distanceLog: [{ distanceM: 0, elapsedSec: 0 }, { distanceM: 1000, elapsedSec: 100 }] };
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [], loop: true, ghost,
  });
  assert.equal(engine.ghost, null);
});

test('RideEngine: loop ルートの summary は distanceLog を保存しない', () => {
  // loop では距離が周回のたびに巻き戻るため、次回のゴーストとして使うと
  // 誤った比較になる。保存自体をしないことで壊れたゴーストを防ぐ
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 35.001, lng: 139 }]);
  const engine = new RideEngine({
    path, source: makeStubSource(), elevations: [], loop: true,
  });
  engine.live.speedKmh = 20;
  engine.advance(5);
  assert.deepEqual(engine.summary().distanceLog, []);
});

test('RideEngine: 非 loop ルートの summary には distanceLog が含まれる', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.live.speedKmh = 20;
  engine.advance(5);
  assert.ok(engine.summary().distanceLog.length > 0);
});

test('RideEngine: 途中終了しても finish() 時点の位置が distanceLog に確定する', () => {
  // 25m のログ間隔に届かないうちに finish() された場合でも、次回このルートを
  // 走ったときにゴーストとして使えるよう最終地点を確定させる必要がある
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.live.speedKmh = 3.6; // 1 m/s
  engine.advance(3); // 3m しか進まない（25m 未満）

  assert.equal(engine.distanceLog.length, 1, '前提: この時点ではまだ記録されていない');
  engine.finish();
  assert.equal(engine.distanceLog.length, 2);
  const last = engine.distanceLog[engine.distanceLog.length - 1];
  assert.ok(Math.abs(last.distanceM - 3) < 0.01, `実際: ${last.distanceM}`);
  assert.ok(engine.summary().distanceLog.length >= 2);
});

test('RideEngine: 開始直後(距離0)で finish() しても重複記録しない', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.finish();
  assert.equal(engine.distanceLog.length, 1);
});

test('RideEngine: dt が 0 以下なら何も進めない', () => {
  const path = buildPath([{ lat: 35, lng: 139 }, { lat: 36, lng: 139 }]);
  const engine = new RideEngine({ path, source: makeStubSource(), elevations: [] });
  engine.live.speedKmh = 30;
  engine.advance(0);
  engine.advance(-5);
  assert.equal(engine.distanceM, 0);
  assert.equal(engine.elapsedSec, 0);
});

/* ============ 集計 ============ */

test('currentStreak: 連続実施日数を数える', () => {
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return { startedAt: d.toISOString() };
  };
  assert.equal(currentStreak([]), 0);
  assert.equal(currentStreak([day(0), day(1), day(2)]), 3);
  // 途中で1日空くとそこで止まる
  assert.equal(currentStreak([day(0), day(1), day(3)]), 2);
  // 今日未実施でも昨日から数える
  assert.equal(currentStreak([day(1), day(2)]), 2);
});

test('kcalWithin: 期間内のカロリーだけを合計する', () => {
  const mk = (offsetDays, kcal) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return { startedAt: d.toISOString(), kcal };
  };
  const sessions = [mk(1, 300), mk(3, 200), mk(20, 500)];
  assert.equal(kcalWithin(sessions, 7), 500);
  assert.equal(kcalWithin(sessions, 30), 1000);
});

test('zoneTotals: 期間内の心拍ゾーン滞在時間を合計する', () => {
  const mk = (offsetDays, zoneSeconds) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return { startedAt: d.toISOString(), zoneSeconds };
  };
  const sessions = [
    mk(1, { z2: 600, z3: 300 }),
    mk(3, { z2: 400, z4: 100 }),
    mk(20, { z2: 9999 }), // 期間外
  ];
  const t = zoneTotals(sessions, 7);
  assert.equal(t.z2, 1000);
  assert.equal(t.z3, 300);
  assert.equal(t.z4, 100);
  assert.equal(t.z5, undefined);
});

test('zoneTotals: 心拍データが無いセッションでも壊れない', () => {
  const s = [{ startedAt: new Date().toISOString() }];
  assert.deepEqual(zoneTotals(s, 7), {});
});

/* ============ 目標体重の達成予測 ============ */

/** offsetDays 日前から1日おきに weights を並べたテストデータを作る */
function weightSeries(values, stepDays = 2) {
  const total = (values.length - 1) * stepDays;
  return values.map((w, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (total - i * stepDays));
    return { date: d.toISOString().slice(0, 10), weightKg: w };
  });
}

test('predictGoalDate: 減量ペースから到達日を予測する', () => {
  // weightSeries は (5点-1)×2日 = 8日間のデータを作る。8日で 80→78kg
  // なので週ペースは -1.75kg、現在78kgから目標75kgまで3kg・約12日。
  const r = predictGoalDate(weightSeries([80, 79.5, 79, 78.5, 78]), 75);
  assert.equal(r.status, 'ok');
  assert.ok(Math.abs(r.kgPerWeek - -1.75) < 0.01, `週あたり: ${r.kgPerWeek}`);
  assert.ok(r.daysLeft > 5 && r.daysLeft < 20, `実際: ${r.daysLeft}日`);
  assert.ok(r.date instanceof Date);
});

test('predictGoalDate: 記録が少なければ推測しない', () => {
  assert.equal(predictGoalDate([], 70).status, 'need-more-data');
  assert.equal(predictGoalDate(weightSeries([80, 79]), 70).status, 'need-more-data');
});

test('predictGoalDate: 期間が短ければ推測しない', () => {
  // 4点あるが3日ぶんしかない
  const r = predictGoalDate(weightSeries([80, 79.8, 79.6, 79.4], 1), 75);
  assert.equal(r.status, 'need-more-days');
});

test('predictGoalDate: 目標から遠ざかっていれば正直に伝える', () => {
  const r = predictGoalDate(weightSeries([78, 78.5, 79, 79.5, 80]), 75);
  assert.equal(r.status, 'not-approaching');
  assert.ok(r.kgPerWeek > 0);
});

test('predictGoalDate: 達成済みなら達成と判定する', () => {
  const r = predictGoalDate(weightSeries([76, 75.5, 75.2, 75.1, 75.0]), 75);
  assert.equal(r.status, 'reached');
});

test('predictGoalDate: 何年も先になる場合は数字を出さない', () => {
  // ほぼ横ばい（16日で 0.1kg 減）で目標まで 10kg
  const r = predictGoalDate(weightSeries([80, 79.98, 79.96, 79.94, 79.9]), 70);
  assert.equal(r.status, 'too-far');
});

test('predictGoalDate: 目標未設定なら何も出さない', () => {
  assert.equal(predictGoalDate(weightSeries([80, 79, 78, 77, 76]), undefined).status,
    'no-target');
});

/* ============ CSV エクスポート ============ */

test('sessionsToCsv: ヘッダと1行が対応する', () => {
  const csv = sessionsToCsv([{
    startedAt: '2026-08-07T10:00:00.000Z',
    routeName: '皇居一周',
    distanceM: 5000, elapsedSec: 1200, kcal: 250, calorieIsEstimate: false,
    avgPowerW: 150, maxPowerW: 300, avgHeartRateBpm: 130,
    avgSpeedKmh: 25.5, maxSpeedKmh: 38.2,
    zoneSeconds: { z1: 60, z2: 600, z3: 400, z4: 100, z5: 40 },
  }]);
  const lines = csv.split('\n');
  assert.equal(lines.length, 2);
  const header = lines[0].split(',');
  const row = lines[1].split(',');
  assert.equal(header.length, row.length, 'ヘッダと値の列数が一致すること');
  assert.equal(row[header.indexOf('距離km')], '5.00');
  assert.equal(row[header.indexOf('消費kcal')], '250');
  assert.equal(row[header.indexOf('カロリー算出')], 'パワー実測');
  assert.equal(row[header.indexOf('Z2秒')], '600');
});

test('sessionsToCsv: カンマや引用符を含むルート名を壊さない', () => {
  const csv = sessionsToCsv([{
    startedAt: '2026-08-07T10:00:00.000Z',
    routeName: '皇居, "内堀通り"',
    distanceM: 1000, elapsedSec: 60, kcal: 10,
  }]);
  const row = csv.split('\n')[1];
  assert.ok(row.includes('"皇居, ""内堀通り"""'), `実際: ${row}`);
  // 引用符で囲まれているので、素朴に分割しても列数が崩れないことまでは
  // 保証しないが、値の中身が失われていないことを確認する
  assert.ok(row.includes('内堀通り'));
});

test('sessionsToCsv: 欠けている項目があっても出力できる', () => {
  const csv = sessionsToCsv([{ startedAt: '2026-08-07T10:00:00.000Z' }]);
  const lines = csv.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].split(',').length, lines[1].split(',').length);
});

test('sessionsToCsv: 記録が無くてもヘッダだけ出す', () => {
  const csv = sessionsToCsv([]);
  assert.equal(csv.split('\n').length, 1);
  assert.ok(csv.startsWith('日時,'));
});

/* ============ ルートの同一性判定とゴースト選択 ============ */

test('routeKeyFor: 同じ経路なら同じキーになる', () => {
  const path = buildPath([{ lat: 35.68, lng: 139.76 }, { lat: 35.69, lng: 139.77 }]);
  const same = buildPath([{ lat: 35.68, lng: 139.76 }, { lat: 35.69, lng: 139.77 }]);
  assert.equal(routeKeyFor(path), routeKeyFor(same));
});

test('routeKeyFor: 始点・終点が違えば別キーになる', () => {
  const a = buildPath([{ lat: 35.68, lng: 139.76 }, { lat: 35.69, lng: 139.77 }]);
  const b = buildPath([{ lat: 35.60, lng: 139.70 }, { lat: 35.61, lng: 139.71 }]);
  assert.notEqual(routeKeyFor(a), routeKeyFor(b));
});

test('routeKeyFor: 座標が無ければ null', () => {
  assert.equal(routeKeyFor(null), null);
  assert.equal(routeKeyFor({ points: [] }), null);
});

test('bestGhostFor: 同じルートの最速セッションを選ぶ', () => {
  const sessions = [
    { id: 1, routeKey: 'A', elapsedSec: 600, distanceLog: [{ distanceM: 0, elapsedSec: 0 }, { distanceM: 100, elapsedSec: 600 }] },
    { id: 2, routeKey: 'A', elapsedSec: 500, distanceLog: [{ distanceM: 0, elapsedSec: 0 }, { distanceM: 100, elapsedSec: 500 }] },
    { id: 3, routeKey: 'B', elapsedSec: 100, distanceLog: [{ distanceM: 0, elapsedSec: 0 }, { distanceM: 100, elapsedSec: 100 }] },
  ];
  const ghost = bestGhostFor(sessions, 'A');
  assert.equal(ghost.id, 2);
});

test('bestGhostFor: 除外指定した自分自身は選ばない', () => {
  const sessions = [
    { id: 1, routeKey: 'A', elapsedSec: 500, distanceLog: [{ distanceM: 0, elapsedSec: 0 }, { distanceM: 100, elapsedSec: 500 }] },
    { id: 2, routeKey: 'A', elapsedSec: 400, distanceLog: [{ distanceM: 0, elapsedSec: 0 }, { distanceM: 100, elapsedSec: 400 }] },
  ];
  const ghost = bestGhostFor(sessions, 'A', 2);
  assert.equal(ghost.id, 1);
});

test('bestGhostFor: distanceLog を持たない旧セッションは除外する', () => {
  const sessions = [{ id: 1, routeKey: 'A', elapsedSec: 100 }];
  assert.equal(bestGhostFor(sessions, 'A'), null);
});

test('bestGhostFor: 該当ルートが無ければ null', () => {
  const sessions = [
    { id: 1, routeKey: 'B', elapsedSec: 100, distanceLog: [{ distanceM: 0, elapsedSec: 0 }, { distanceM: 10, elapsedSec: 100 }] },
  ];
  assert.equal(bestGhostFor(sessions, 'A'), null);
  assert.equal(bestGhostFor(sessions, null), null);
});
