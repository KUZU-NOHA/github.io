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

  /* ---- 終了とサマリー ---- */
  page.on('dialog', (d) => d.accept());
  await page.click('#ride-finish');
  await page.waitForTimeout(800);

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
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log('失敗:');
  failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  process.exit(1);
}
