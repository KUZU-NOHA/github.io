/**
 * ブラウザ実動作の検証（Playwright + Chromium）
 *
 *   node test/e2e.mjs
 *
 * API キー無し・BLE 機材無しの状態で、
 *   - アプリがクラッシュせず 2D フォールバックに落ちること
 *   - シミュレーターで実際に走行が進み、距離とカロリーが増えること
 *   - コンソールエラーが出ないこと
 * を確認する。要件定義書 A-04 / 5.7 の検証にあたる。
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8931;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(req.url.split('?')[0]);
      if (path.endsWith('/')) path += 'index.html';
      const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

// decodePolyline（geo.js）の逆変換。Routes API のモック応答を作るためだけに使う簡易エンコーダ
function encodePolylineValue(v) {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = '';
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
}
function encodePolyline(points) {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += encodePolylineValue(lat - prevLat) + encodePolylineValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}
/** computeRoutes の最小限のモック応答を組み立てる */
function mockRoutesApiFulfill(points, distanceMeters) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      routes: [{
        polyline: { encodedPolyline: encodePolyline(points) },
        distanceMeters,
        duration: '900s',
      }],
    }),
  };
}

const server = await startServer();

// この環境には Chromium がプリインストールされている。playwright の
// 期待するビルド番号と一致しないことがあるので、実体を直接指定する。
const { existsSync } = await import('node:fs');
const localChrome = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].find((p) => existsSync(p));

const browser = await chromium.launch(
  localChrome ? { executablePath: localChrome } : {}
);
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  /* ---- ランディングページ ---- */
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  check('ランディングページが開く', (await page.title()).includes('バーチャルサイクリング'));

  /* ---- アプリ本体（API キー無し） ---- */
  await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  check(
    'キー未設定なら設定画面が出る',
    await page.locator('#screen-setup').isVisible()
  );

  await page.click('#api-key-skip');
  check('キー無しでもルート画面へ進める', await page.locator('#screen-route').isVisible());

  /* ---- プリセットルートの選択 ---- */
  const presetCount = await page.locator('#preset-list button').count();
  check('プリセットルートが並ぶ', presetCount >= 5, `${presetCount} 件`);

  await page.click('[data-preset="imperial-palace"]');
  await page.waitForSelector('#route-ready:not([hidden])', { timeout: 5000 });
  const summary = await page.locator('#route-summary').innerText();
  check('ルートの距離が表示される', /\d+\.\d+ km/.test(summary), summary.replace(/\n/g, ' / '));

  /* ---- 走行画面へ ---- */
  await page.click('#route-ready [data-nav="ride"]');
  check('走行画面へ遷移する', await page.locator('#screen-ride').isVisible());

  const bleNote = await page.locator('#ble-note').innerText();
  check(
    'Web Bluetooth 非対応を正しく案内する',
    bleNote.includes('WebBLE') || bleNote.includes('使えます'),
    bleNote.slice(0, 60)
  );

  /* ---- シミュレーターで走行 ---- */
  await page.click('#connect-sim');
  check('シミュレーターに接続できる',
    (await page.locator('#source-name').innerText()).includes('シミュレーター'));

  await page.click('#ride-start');
  await page.waitForTimeout(600);

  check('2D フォールバックが描画される',
    await page.locator('#map-stage canvas').count() > 0);

  // 3秒走らせて数値が増えることを確認する
  const read = async () => ({
    distance: parseFloat(await page.locator('[data-hud="distance"]').innerText()),
    kcal: parseFloat(await page.locator('[data-hud="kcal"]').innerText()),
    time: await page.locator('[data-hud="time"]').innerText(),
    speed: parseFloat(await page.locator('[data-hud="speed"]').innerText()),
    power: parseFloat(await page.locator('[data-hud="power"]').innerText()),
  });

  await page.waitForTimeout(3000);
  const a = await read();
  check('速度が発生する', a.speed > 0, `${a.speed} km/h`);
  check('パワーが発生する', a.power > 0, `${a.power} W`);
  check('距離が増える', a.distance > 0, `${a.distance} km`);
  check('経過時間が進む', a.time !== '00:00', a.time);

  await page.waitForTimeout(2500);
  const b = await read();
  check('走行を続けると距離がさらに増える', b.distance > a.distance,
    `${a.distance} → ${b.distance} km`);
  check('消費カロリーが積算される', b.kcal > 0, `${b.kcal} kcal`);

  const kcalNote = await page.locator('[data-hud="kcalNote"]').innerText();
  check('カロリーの算出方式が明示される', kcalNote.length > 0, kcalNote);

  const progress = await page.locator('[data-hud="progressBar"]').evaluate((el) => el.style.width);
  check('進捗バーが伸びる', parseFloat(progress) > 0, progress);

  await page.screenshot({ path: 'test/screenshot-ride.png' });

  /* ---- 一時停止 ---- */
  await page.click('#ride-pause');
  await page.waitForTimeout(200);
  const paused = await read();
  await page.waitForTimeout(1200);
  const stillPaused = await read();
  check('一時停止で距離が止まる',
    Math.abs(stillPaused.distance - paused.distance) < 0.01,
    `${paused.distance} → ${stillPaused.distance} km`);

  /* ---- 全画面表示 ---- */
  const fullscreenSupported = await page.evaluate(() => document.fullscreenEnabled);
  if (fullscreenSupported) {
    // HUD 上の複製ボタンで再開できることを確認（サイドパネルのボタンと同期する）
    await page.click('#hud-pause');
    await page.waitForTimeout(300);
    check('HUDの一時停止ボタンで再開できる',
      (await page.locator('#ride-pause').innerText()) === '一時停止');

    await page.click('#fullscreen-toggle');
    await page.waitForTimeout(600);

    const stageState = await page.evaluate(() => {
      const el = document.getElementById('ride-stage');
      const r = el.getBoundingClientRect();
      return {
        isFullscreenElement: document.fullscreenElement === el,
        matchesViewport: Math.abs(r.width - window.innerWidth) < 2
          && Math.abs(r.height - window.innerHeight) < 2,
      };
    });
    check('全画面表示で ride-stage がビューポート全体になる',
      stageState.isFullscreenElement && stageState.matchesViewport,
      JSON.stringify(stageState));

    const canvasResized = await page.evaluate(() => {
      const canvas = document.querySelector('#map-stage canvas');
      const stage = document.getElementById('ride-stage');
      if (!canvas) return true; // 3D モード等で canvas が無い場合は対象外
      const dpr = window.devicePixelRatio || 1;
      return Math.abs(canvas.width - Math.round(stage.clientWidth * dpr)) < 4;
    });
    check('全画面化で 2D フォールバックの canvas も追従してリサイズされる', canvasResized);

    check('全画面中も HUD の一時停止ボタンが有効', !(await page.locator('#hud-pause').isDisabled()));
    check('全画面中も HUD の終了ボタンが有効', !(await page.locator('#hud-finish').isDisabled()));

    // 全画面のまま HUD 側の終了ボタンを押す → 自動解除されてサマリーが見えること
    page.on('dialog', (d) => d.accept());
    await page.click('#hud-finish');
    await page.waitForTimeout(800);

    check('全画面中に終了すると自動的に解除される',
      !(await page.evaluate(() => !!document.fullscreenElement)));
  } else {
    check('Fullscreen API 非対応環境では全画面ボタンが隠れる',
      await page.locator('#fullscreen-toggle').isHidden());

    page.on('dialog', (d) => d.accept());
    await page.click('#ride-finish');
    await page.waitForTimeout(800);
  }

  /* ---- 終了とサマリー ---- */
  check('走行完了サマリーが表示される', await page.locator('#ride-summary').isVisible());
  const summaryDistance = await page.locator('[data-summary="distance"]').innerText();
  check('サマリーに距離が出る', parseFloat(summaryDistance) > 0, `${summaryDistance} km`);
  const summaryKcalNote = await page.locator('[data-summary="kcalNote"]').innerText();
  check('サマリーにカロリー算出方式が出る', summaryKcalNote.length > 0, summaryKcalNote);

  await page.click('#ride-summary [data-summary-close]');
  await page.waitForTimeout(200);
  check('サマリーを閉じると記録画面へ移る',
    await page.locator('#screen-dashboard').isVisible()
    && !(await page.locator('#ride-summary').isVisible()));

  const sessionItems = await page.locator('[data-dash="sessionList"] li:not(.empty)').count();
  check('走行記録が保存される', sessionItems > 0, `${sessionItems} 件`);

  const totalKm = await page.locator('[data-dash="totalKm"]').innerText();
  check('累計距離が集計される', parseFloat(totalKm) > 0, `${totalKm} km`);

  /* ---- 体重記録 ---- */
  await page.fill('#weight-input', '72.5');
  await page.click('#weight-form button[type="submit"]');
  await page.waitForTimeout(400);
  const weight = await page.locator('[data-dash="currentWeight"]').innerText();
  check('体重が記録される', weight.includes('72.5'), weight);

  await page.screenshot({ path: 'test/screenshot-dashboard.png' });

  /* ---- 2回目の走行（状態のリセット漏れを検出する） ---- */
  await page.click('[data-nav="ride"]');
  await page.click('#ride-start');
  await page.waitForTimeout(2500);
  const second = await read();
  check('2回目の走行が開始できる', second.distance > 0, `${second.distance} km`);
  check('2回目でも経過時間が進む', second.time !== '00:00', second.time);

  const profileHtml = await page.locator('#elevation-profile').innerHTML();
  check('2回目でも標高プロファイルが更新される',
    profileHtml.includes('polyline') || profileHtml.trim() === '',
    profileHtml.trim() === '' ? '標高データなしのため空（想定どおり）' : '描画あり');

  if (fullscreenSupported) {
    // F キーのショートカットでも切り替えられることを確認
    await page.keyboard.press('f');
    await page.waitForTimeout(500);
    check('Fキーで全画面表示に切り替わる',
      await page.evaluate(() => !!document.fullscreenElement));
    await page.keyboard.press('f');
    await page.waitForTimeout(500);
    check('Fキーで全画面表示を解除できる',
      !(await page.evaluate(() => !!document.fullscreenElement)));
  }

  await page.click('#ride-finish');
  await page.waitForTimeout(800);
  await page.click('#ride-summary [data-summary-close]');
  await page.waitForTimeout(200);
  const sessions2 = await page.locator('[data-dash="sessionList"] li:not(.empty)').count();
  check('2回目の記録も保存される', sessions2 >= 2, `${sessions2} 件`);

  /* ---- ダッシュボードの新機能 ---- */
  const goalText = await page.locator('[data-dash="goalPrediction"]').innerText();
  check('目標体重の達成予測が表示される', goalText.length > 0, goalText.slice(0, 40));

  await page.click('.session-list details summary');
  await page.waitForTimeout(150);
  const detailVisible = await page.locator('.session-list .session-detail').first().isVisible();
  check('セッション詳細を開ける', detailVisible);

  const csvDownload = page.waitForEvent('download');
  await page.click('#export-csv');
  const csv = await csvDownload;
  check('CSV エクスポートが動く', csv.suggestedFilename().endsWith('.csv'),
    csv.suggestedFilename());

  /* ---- お気に入りルートとゴースト走行（loop なしルートで検証） ---- */
  await page.click('[data-nav="route"]');
  await page.click('[data-preset="golden-gate"]');
  await page.waitForSelector('#route-ready:not([hidden])', { timeout: 5000 });

  await page.click('#route-favorite');
  check('保存ボタンを押すと名前入力フォームが開く',
    await page.locator('#favorite-save-form').isVisible());
  const prefilled = await page.locator('#favorite-name-input').inputValue();
  check('ルート名がデフォルト入力される', prefilled.length > 0, prefilled);
  await page.click('#favorite-save-form button[type="submit"]');
  await page.waitForTimeout(300);
  check('保存後はお気に入りボタンが隠れる',
    await page.locator('#route-favorite').isHidden());

  await page.click('[data-nav="route"]');
  const favCount = await page.locator('#favorite-list [data-favorite]').count();
  check('お気に入りルートが一覧に表示される', favCount >= 1, `${favCount} 件`);

  // 1回目: お気に入りから選んで走行。まだ比較対象が無い
  await page.click('#favorite-list [data-favorite]');
  await page.waitForSelector('#route-ready:not([hidden])');
  await page.click('#route-ready [data-nav="ride"]');
  await page.click('#ride-start');
  await page.waitForTimeout(2500);
  await page.click('#ride-finish');
  await page.waitForTimeout(800);
  check('初回はゴースト比較が出ない',
    await page.locator('[data-summary="ghost"]').isHidden());
  await page.click('#ride-summary [data-summary-close]');
  await page.waitForTimeout(200);

  // 2回目: 同じルートを再度走ると、1回目がゴーストとして現れる
  await page.click('[data-nav="route"]');
  await page.click('#favorite-list [data-favorite]');
  await page.waitForSelector('#route-ready:not([hidden])');
  await page.click('#route-ready [data-nav="ride"]');
  await page.click('#ride-start');
  await page.waitForTimeout(500);
  check('2回目は走行中に前回比のHUDが出る',
    !(await page.locator('[data-hud="ghostRow"]').isHidden()));
  await page.waitForTimeout(2000);
  await page.click('#ride-finish');
  await page.waitForTimeout(800);
  check('2回目のサマリーにゴースト比較が出る',
    await page.locator('[data-summary="ghost"]').isVisible());
  const ghostText = await page.locator('[data-summary="ghost"]').innerText();
  check('ゴースト比較に文言が入る', ghostText.length > 5, ghostText);
  await page.click('#ride-summary [data-summary-close]');
  await page.waitForTimeout(200);

  // お気に入りの削除
  await page.click('[data-nav="route"]');
  await page.click('#favorite-list [data-favorite-delete]'); // confirm は accept される
  await page.waitForTimeout(300);
  const favCountAfter = await page.locator('#favorite-list [data-favorite]').count();
  check('お気に入りルートを削除できる', favCountAfter === favCount - 1,
    `${favCount} → ${favCountAfter}`);

  /* ---- コンソールエラー ---- */
  check('コンソールエラーが出ない', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));

} catch (err) {
  check('例外が発生していない', false, err.message);
  await page.screenshot({ path: 'test/screenshot-failure.png' }).catch(() => {});
} finally {
  await browser.close();
}

/* ============================================================
 * 2D フォールバックの背景地図取得（別コンテキストで独立に検証）
 *
 * 本物の API キーは無いため、Google Maps JavaScript API 本体をブロック
 * して 3D 初期化を意図的に失敗させ、Fallback2D に確実に落とす。
 * Static Maps API へのリクエストはダミー画像で応答し、
 *   - 正しいパラメータ（center/zoom/size）でちょうど1回だけ呼ばれること
 *   - 画像取得後もエラー無く描画・走行が続くこと
 *   - ウィンドウリサイズ後も投影計算が壊れないこと
 * を確認する。
 * ============================================================ */
try {
  const bgBrowser = await chromium.launch(
    localChrome ? { executablePath: localChrome } : {}
  );
  const bgPage = await bgBrowser.newPage({ viewport: { width: 1280, height: 860 } });

  const bgConsoleErrors = [];
  bgPage.on('console', (m) => {
    if (m.type() === 'error') bgConsoleErrors.push(m.text());
  });
  bgPage.on('pageerror', (e) => bgConsoleErrors.push(`pageerror: ${e.message}`));

  const staticMapRequests = [];
  await bgPage.route('**/maps.googleapis.com/maps/api/js**', (route) => route.abort());
  // selectRoute() は API キーがあると Elevation API も呼ぶ。モックしないと
  // 実ネットワークへのリクエストが詰まり、ルート選択自体が進まなくなる
  await bgPage.route('**/maps.googleapis.com/maps/api/elevation/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"OK","results":[]}' })
  );
  // プリセットは Routes API で道路スナップを試みる（routeFromPresetRefined）。
  // モックしないと実キーではない TEST_KEY_FOR_MOCK で本物のエンドポイントに
  // 当ててしまい、失敗までの待ち時間でルート選択がタイムアウトする
  await bgPage.route('**/routes.googleapis.com/**', (route) =>
    route.fulfill(mockRoutesApiFulfill(
      [{ lat: 37.8065, lng: -122.4750 }, { lat: 37.8341, lng: -122.4794 }], 3200
    ))
  );
  const dummyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  await bgPage.route('**/maps.googleapis.com/maps/api/staticmap**', (route) => {
    staticMapRequests.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'image/png', body: dummyPng });
  });

  await bgPage.goto(`http://localhost:${PORT}/app/`, { waitUntil: 'networkidle' });
  await bgPage.evaluate(() => localStorage.clear());
  // 通信は全てモックするので実キーは不要。hasApiKey() を true にするためだけの値
  await bgPage.evaluate(() => localStorage.setItem('vcycling.apiKey', 'TEST_KEY_FOR_MOCK'));
  await bgPage.reload({ waitUntil: 'networkidle' });

  await bgPage.click('[data-preset="golden-gate"]');
  await bgPage.waitForSelector('#route-ready:not([hidden])', { timeout: 5000 });
  await bgPage.click('#route-ready [data-nav="ride"]');
  await bgPage.click('#connect-sim');
  await bgPage.click('#ride-start');
  await bgPage.waitForTimeout(1500);

  check('Maps JS API ブロック時は 2D フォールバックの canvas が出る',
    (await bgPage.locator('#map-stage canvas').count()) > 0);

  check('Static Maps API へのリクエストが1回だけ発生する',
    staticMapRequests.length === 1, `${staticMapRequests.length} 回`);

  const reqUrl = staticMapRequests[0] ?? '';
  check('リクエストに center/zoom/size が含まれる',
    /center=/.test(reqUrl) && /zoom=\d+/.test(reqUrl) && /size=\d+x\d+/.test(reqUrl),
    reqUrl);

  // ウィンドウリサイズ後も投影計算がエラーにならず描画が続くこと
  await bgPage.setViewportSize({ width: 800, height: 1000 });
  await bgPage.waitForTimeout(500);
  check('リサイズ後もエラー無く canvas が残る',
    (await bgPage.locator('#map-stage canvas').count()) > 0);

  // 意図的にブロックした Maps JS API 自体のネットワークエラーは想定内なので除外する
  const unexpectedErrors = bgConsoleErrors.filter(
    (e) => !/net::ERR_FAILED|net::ERR_CONNECTION_RESET|maps\/api\/js/.test(e)
  );
  check('想定外のコンソールエラーが出ない', unexpectedErrors.length === 0,
    unexpectedErrors.slice(0, 3).join(' | '));

  await bgBrowser.close();
} catch (err) {
  check('背景地図シナリオで例外が発生していない', false, err.message);
}

/* ============================================================
 * プリセットルートの道路スナップ（Routes API の経由地点）
 *
 * プリセットの座標は手作業による粗い近似のため、そのまま直線で結ぶと
 * 建物や川を突っ切ってしまう問題があった（routeFromPresetRefined での対応）。
 * Routes API の computeRoutes をモックし、
 *   - プリセットの中間点が intermediates として送られること
 *   - 取得した経路（モック応答の polyline）に実際に差し替わること
 *   - API キーが無い場合は Routes API を呼ばず、警告付きで概算ルートに
 *     フォールバックすること
 * を確認する。
 * ============================================================ */
try {
  const rpBrowser = await chromium.launch(
    localChrome ? { executablePath: localChrome } : {}
  );
  const rpPage = await rpBrowser.newPage({ viewport: { width: 1280, height: 860 } });

  const rpConsoleErrors = [];
  rpPage.on('console', (m) => {
    if (m.type() === 'error') rpConsoleErrors.push(m.text());
  });
  rpPage.on('pageerror', (e) => rpConsoleErrors.push(`pageerror: ${e.message}`));

  // 地図表示自体はこのシナリオの対象外なので、Maps JS はブロックして 2D フォールバックへ
  await rpPage.route('**/maps.googleapis.com/maps/api/js**', (route) => route.abort());
  await rpPage.route('**/maps.googleapis.com/maps/api/elevation/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"OK","results":[]}' })
  );

  // プリセット（皇居一周）の実座標とは明確に異なる、片道5.12km相当のダミー経路。
  // 皇居一周は始点=終点のループなので2区間に分けてリクエストされ（fetchLoopRoute）、
  // 同じダミー経路が2回連結されて表示距離は往復分の 20.50km になる。
  // この距離が表示されていれば、モック応答へ実際に差し替わった証拠になる
  let routesApiRequests = [];
  await rpPage.route('**/routes.googleapis.com/**', (route) => {
    routesApiRequests.push(JSON.parse(route.request().postData()));
    route.fulfill(mockRoutesApiFulfill(
      [{ lat: 35.6852, lng: 139.7528 }, { lat: 35.7200, lng: 139.7900 }, { lat: 35.6852, lng: 139.7528 }],
      5124
    ));
  });

  await rpPage.goto(`http://localhost:${PORT}/app/`, { waitUntil: 'networkidle' });
  await rpPage.evaluate(() => localStorage.clear());
  // 通信は全てモックするので実キーは不要。hasApiKey() を true にするためだけの値
  await rpPage.evaluate(() => localStorage.setItem('vcycling.apiKey', 'TEST_KEY_FOR_MOCK'));
  await rpPage.reload({ waitUntil: 'networkidle' });

  await rpPage.click('[data-preset="imperial-palace"]');
  await rpPage.waitForSelector('#route-ready:not([hidden])', { timeout: 5000 });

  check('ループのプリセットは起点=終点を避けて2区間に分けてリクエストする',
    routesApiRequests.length === 2 && routesApiRequests.every((b) => b.intermediates?.length > 0),
    `呼び出し ${routesApiRequests.length} 回`);

  check('各リクエストの始点と終点が同一座標にならない（退化ルートの原因だった不具合の再発防止）',
    routesApiRequests.every((b) =>
      b.origin.location.latLng.latitude !== b.destination.location.latLng.latitude
      || b.origin.location.latLng.longitude !== b.destination.location.latLng.longitude
    ),
    JSON.stringify(routesApiRequests.map((b) => [b.origin.location.latLng, b.destination.location.latLng])));

  const rpSummary = await rpPage.locator('#route-summary').innerText();
  check('道路スナップ後のルートに実際に差し替わる（モック応答2区間分の距離が表示される）',
    rpSummary.includes('20.50 km'), rpSummary.replace(/\n/g, ' / '));

  /* ---- API キーが無い場合は Routes API を呼ばずフォールバックする ---- */
  await rpPage.evaluate(() => localStorage.removeItem('vcycling.apiKey'));
  await rpPage.reload({ waitUntil: 'networkidle' });
  await rpPage.click('#api-key-skip');
  routesApiRequests = [];

  await rpPage.click('[data-preset="osaka-castle"]');
  await rpPage.waitForSelector('#route-ready:not([hidden])', { timeout: 5000 });

  check('API キーが無い場合は Routes API を呼ばない',
    routesApiRequests.length === 0, `${routesApiRequests.length} 回`);
  const toastText = await rpPage.locator('#toast').innerText();
  check('API キーが無い場合は概算ルートである旨の警告が出る',
    toastText.includes('API キー') || toastText.includes('概算'), toastText);

  const rpUnexpectedErrors = rpConsoleErrors.filter(
    (e) => !/net::ERR_FAILED|net::ERR_CONNECTION_RESET|maps\/api\/js/.test(e)
  );
  check('プリセット道路スナップのシナリオで想定外のコンソールエラーが出ない',
    rpUnexpectedErrors.length === 0, rpUnexpectedErrors.slice(0, 3).join(' | '));

  await rpBrowser.close();
} catch (err) {
  check('プリセット道路スナップのシナリオで例外が発生していない', false, err.message);
} finally {
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log('失敗:');
  failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  process.exit(1);
}
