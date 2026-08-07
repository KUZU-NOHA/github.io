/**
 * アプリ全体の配線
 *
 * 画面遷移: setup → route → ride → dashboard
 * 各モジュールは互いを知らず、ここでのみ結合する。
 */

import {
  getApiKey, setApiKey, hasApiKey, loadSettings, saveSettings,
  loadGoogleMaps, DEFAULT_SETTINGS,
} from './config.js';
import { buildPath } from './map/geo.js';
import {
  PRESET_ROUTES, fetchRoute, fetchElevations, routeFromPreset, routeFromGpxFile,
} from './map/route.js';
import { View3D } from './map/view3d.js';
import { Fallback2D } from './map/fallback2d.js';
import { StreetViewSpot, CheckpointTracker } from './map/streetview.js';
import { BikeSensor } from './ble/bike.js';
import { HeartRateMonitor } from './ble/heartRate.js';
import { SimulatedTrainer } from './ble/simulator.js';
import { RideEngine, RideState } from './ride/engine.js';
import { Hud, renderElevationProfile, formatDuration } from './ui/hud.js';
import { Dashboard } from './ui/dashboard.js';
import { saveSession } from './store/sessions.js';

const app = {
  settings: loadSettings(),
  route: null,        // {path, elevations, name, loop, warning}
  source: null,       // FtmsTrainer | SimulatedTrainer
  heartRate: null,
  engine: null,
  view: null,         // View3D | Fallback2D
  streetView: null,
  checkpoints: new CheckpointTracker(1000),
  hud: null,
  dashboard: null,
  mapsReady: false,
};

/* ---------------- 画面遷移 ---------------- */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => {
    s.hidden = s.id !== `screen-${id}`;
  });
  document.querySelectorAll('[data-nav]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.nav === id);
  });
  // 画面を切り替えたら先頭から見せる（前の画面のスクロール位置が残ると
  // 遷移先の見出しが隠れてしまう）
  window.scrollTo(0, 0);
  if (id === 'dashboard') app.dashboard?.refresh();
}

function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast is-${kind} is-visible`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove('is-visible'), 5200);
}

/* ---------------- 初期化 ---------------- */

async function init() {
  app.dashboard = new Dashboard(document.getElementById('screen-dashboard'), app.settings);
  app.hud = new Hud(document.getElementById('screen-ride'), { age: app.settings.age });

  bindNav();
  bindSetup();
  bindRouteScreen();
  bindRideScreen();
  bindDashboard();
  renderSettingsForm();
  renderPresets();
  updateBleAvailability();

  // API キーがあれば Maps を先に読み込んでおく（走行開始を速くするため）
  if (hasApiKey()) {
    loadGoogleMaps()
      .then(() => { app.mapsReady = true; setMapsStatus(true); })
      .catch((err) => { setMapsStatus(false, err.message); });
    showScreen('route');
  } else {
    showScreen('setup');
  }

  await app.dashboard.refresh();
}

function bindNav() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.nav === 'ride' && !app.route) {
        toast('先にルートを選んでください', 'warn');
        showScreen('route');
        return;
      }
      showScreen(btn.dataset.nav);
    });
  });
}

/* ---------------- 設定画面 ---------------- */

function bindSetup() {
  const input = document.getElementById('api-key-input');
  input.value = getApiKey();

  document.getElementById('api-key-save').addEventListener('click', async () => {
    const key = input.value.trim();
    setApiKey(key);
    if (!key) {
      toast('API キーを削除しました。2D 表示モードで動作します。');
      showScreen('route');
      return;
    }
    toast('API キーを保存しました。Google Maps を読み込みます…');
    try {
      await loadGoogleMaps();
      app.mapsReady = true;
      setMapsStatus(true);
      toast('Google Maps の読み込みに成功しました', 'ok');
      showScreen('route');
    } catch (err) {
      setMapsStatus(false, err.message);
      toast(err.message, 'error');
    }
  });

  document.getElementById('api-key-skip').addEventListener('click', () => {
    toast('2D 表示モードで開始します。3D 映像には API キーが必要です。');
    showScreen('route');
  });
}

function setMapsStatus(ok, message = '') {
  const el = document.getElementById('maps-status');
  if (!el) return;
  el.textContent = ok
    ? '✅ Google Maps 読み込み済み（3D 映像が使えます）'
    : `⚠️ ${message || 'Google Maps を読み込めません'}`;
  el.className = `status ${ok ? 'is-ok' : 'is-warn'}`;
}

function renderSettingsForm() {
  const form = document.getElementById('settings-form');
  if (!form) return;
  for (const [key, value] of Object.entries(app.settings)) {
    const field = form.elements[key];
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = !!value;
    else field.value = value;
  }
  form.addEventListener('change', () => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const field = form.elements[key];
      if (!field) continue;
      app.settings[key] =
        field.type === 'checkbox' ? field.checked : coerceNumber(field.value);
    }
    saveSettings(app.settings);
    // 走行中でも即座に反映する
    if (app.engine) {
      app.engine.speedMultiplier = app.settings.speedMultiplier;
      app.engine.gradeEnabled = app.settings.gradeEnabled;
      app.engine.age = app.settings.age;
    }
    app.view?.setCamera({
      rangeM: app.settings.cameraRangeM,
      tilt: app.settings.cameraTilt,
    });
    if (app.hud) app.hud.age = app.settings.age;
  });
}

function coerceNumber(v) {
  const n = Number(v);
  return v !== '' && Number.isFinite(n) ? n : v;
}

/* ---------------- ルート選択 ---------------- */

function renderPresets() {
  const list = document.getElementById('preset-list');
  list.innerHTML = PRESET_ROUTES.map(
    (p) => `
    <li>
      <button class="preset" data-preset="${p.id}">
        <span class="preset-city">${p.city}</span>
        <strong>${p.name}</strong>
        <span class="muted">${p.description}</span>
      </button>
    </li>`
  ).join('');

  list.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const preset = PRESET_ROUTES.find((p) => p.id === btn.dataset.preset);
      await selectRoute(routeFromPreset(preset));
    });
  });
}

function bindRouteScreen() {
  document.getElementById('route-search').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!hasApiKey()) {
      toast('地点検索には API キーが必要です。プリセットか GPX をお使いください。', 'warn');
      return;
    }
    const from = parseLatLng(document.getElementById('route-from').value);
    const to = parseLatLng(document.getElementById('route-to').value);
    if (!from || !to) {
      toast('緯度,経度の形式で入力してください（例: 35.6852,139.7528）', 'warn');
      return;
    }
    setRouteBusy(true);
    try {
      const result = await fetchRoute(from, to);
      await selectRoute({ ...result, name: '検索ルート', loop: false });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRouteBusy(false);
    }
  });

  document.getElementById('gpx-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRouteBusy(true);
    try {
      await selectRoute(await routeFromGpxFile(file));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRouteBusy(false);
      e.target.value = '';
    }
  });
}

function parseLatLng(text) {
  const m = String(text).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function setRouteBusy(busy) {
  document.getElementById('route-busy').hidden = !busy;
}

async function selectRoute(result) {
  const { path } = result;
  let elevations = result.elevations ?? [];

  // GPX に標高が無く API キーがある場合のみ Elevation API を呼ぶ
  if (elevations.length === 0 && hasApiKey()) {
    setRouteBusy(true);
    elevations = await fetchElevations(path);
    setRouteBusy(false);
  }

  app.route = {
    path,
    elevations,
    name: result.name ?? 'ルート',
    loop: result.loop ?? app.settings.loop,
    warning: result.warning ?? null,
  };

  const km = (path.totalDistanceM / 1000).toFixed(2);
  const climb = totalClimb(elevations);
  document.getElementById('route-summary').innerHTML = `
    <strong>${escapeHtml(app.route.name)}</strong>
    <span>${km} km</span>
    ${elevations.length ? `<span>獲得標高 ${Math.round(climb)} m</span>` : '<span class="muted">標高データなし</span>'}
  `;
  document.getElementById('route-ready').hidden = false;

  if (app.route.warning) toast(app.route.warning, 'warn');
  else toast(`ルートを設定しました（${km} km）`, 'ok');
}

function totalClimb(elevations) {
  let sum = 0;
  for (let i = 1; i < elevations.length; i++) {
    const d = elevations[i] - elevations[i - 1];
    if (d > 0) sum += d;
  }
  return sum;
}

/* ---------------- BLE 接続 ---------------- */

/**
 * バイクに接続する。
 * acceptAll=true は「サービスを広告しない機種」を拾うための逃げ道。
 * 一体型エアロバイクではこちらでないと見つからないことがある。
 */
async function connectBike({ acceptAll }) {
  try {
    const bike = new BikeSensor({
      wheelCircumferenceMm: app.settings.wheelCircumferenceMm,
      totalMassKg: app.settings.weightKg + 9,
    });
    await bike.connect({ acceptAll });
    setSource(bike);
    toast(`${bike.name} に接続しました — ${bike.description}`, 'ok');
  } catch (err) {
    // ユーザーがダイアログを閉じただけのケースは通常のフローなので騒がない
    if (err.name === 'NotFoundError' && /cancel|User cancelled/i.test(err.message)) {
      return;
    }
    toast(`接続に失敗しました: ${err.message}`, 'error');
  }
}

function updateBleAvailability() {
  const supported = BikeSensor.isSupported;
  const note = document.getElementById('ble-note');
  document.getElementById('connect-trainer').disabled = !supported;
  document.getElementById('connect-any').disabled = !supported;
  document.getElementById('connect-hr').disabled = !supported;
  if (!supported) {
    note.textContent =
      '⚠️ このブラウザは Web Bluetooth に非対応です。PC/Mac の Chrome、または iPhone では App Store の「WebBLE」ブラウザをお使いください。シミュレーターは今のまま使えます。';
    note.className = 'status is-warn';
  } else {
    note.textContent = '✅ Web Bluetooth が使えます';
    note.className = 'status is-ok';
  }
}

function bindRideScreen() {
  document
    .getElementById('connect-trainer')
    .addEventListener('click', () => connectBike({ acceptAll: false }));
  document
    .getElementById('connect-any')
    .addEventListener('click', () => connectBike({ acceptAll: true }));

  document.getElementById('connect-sim').addEventListener('click', async () => {
    const sim = new SimulatedTrainer({
      targetPowerW: Number(document.getElementById('sim-power').value) || 150,
      riderWeightKg: app.settings.weightKg + 9,
    });
    await sim.connect();
    setSource(sim);
    toast('シミュレーターを開始しました', 'ok');
  });

  document.getElementById('sim-power').addEventListener('input', (e) => {
    document.getElementById('sim-power-value').textContent = `${e.target.value} W`;
    if (app.source?.isSimulated) app.source.setTargetPower(Number(e.target.value));
  });

  document.getElementById('connect-hr').addEventListener('click', async () => {
    try {
      const hr = new HeartRateMonitor();
      await hr.connect();
      app.heartRate = hr;
      hr.addEventListener('data', (e) => {
        if (app.engine) app.engine.live.heartRateBpm = e.detail.heartRateBpm;
      });
      toast(`${hr.name} に接続しました`, 'ok');
    } catch (err) {
      toast(`心拍計の接続に失敗しました: ${err.message}`, 'error');
    }
  });

  document.getElementById('ride-start').addEventListener('click', startRide);
  document.getElementById('ride-pause').addEventListener('click', togglePause);
  document.getElementById('ride-finish').addEventListener('click', () => {
    if (app.engine && confirm('走行を終了して記録を保存しますか？')) {
      app.engine.finish();
    }
  });

  document.getElementById('sv-toggle').addEventListener('click', async () => {
    if (!app.streetView) {
      toast('ストリートビューには API キーが必要です', 'warn');
      return;
    }
    const s = app.engine?.snapshot();
    const ok = await app.streetView.toggle(
      s?.position ?? app.route.path.points[0],
      s?.heading ?? 0
    );
    if (ok === false && !app.streetView.visible) {
      toast('この地点にはストリートビューがありません', 'warn');
    }
  });

  // 走行中の誤リロードを防ぐ（要件定義書 A-03）
  window.addEventListener('beforeunload', (e) => {
    if (app.engine?.isRiding) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function setSource(source) {
  if (app.source && app.source !== source) app.source.disconnect();
  app.source = source;

  document.getElementById('source-name').textContent = source.name;
  document.getElementById('source-status').textContent = source.isSimulated
    ? 'シミュレーター動作中'
    : (source.description ?? '接続済み');
  document.getElementById('ride-start').disabled = false;

  source.addEventListener('disconnected', () => {
    toast('デバイスが切断されました', 'warn');
    document.getElementById('source-status').textContent = '切断されました';
  });
}

/* ---------------- 走行 ---------------- */

async function startRide() {
  if (!app.route) {
    toast('先にルートを選んでください', 'warn');
    showScreen('route');
    return;
  }
  if (!app.source) {
    toast('トレーナーに接続するか、シミュレーターを開始してください', 'warn');
    return;
  }
  if (app.engine?.isRiding) return;

  // 一時停止からの再開
  if (app.engine && app.engine.state === RideState.PAUSED) {
    app.engine.start();
    return;
  }

  await setupView();

  // 走行ごとに経過時間が 0 に戻るため、前回の走行の値が残っていると
  // 標高プロファイルが再描画されなくなる
  lastProfileAt = 0;
  app.checkpoints.reset();
  app.engine = new RideEngine({
    path: app.route.path,
    elevations: app.route.elevations,
    source: app.source,
    weightKg: app.settings.weightKg,
    age: app.settings.age,
    speedMultiplier: app.settings.speedMultiplier,
    gradeEnabled: app.settings.gradeEnabled,
    loop: app.route.loop,
  });

  app.engine.addEventListener('tick', (e) => onTick(e.detail));
  app.engine.addEventListener('statechange', (e) => onStateChange(e.detail));
  app.engine.addEventListener('finish', (e) => onFinish(e.detail));

  app.engine.start();
  document.getElementById('ride-stage').classList.add('is-riding');
  toast('走行を開始しました。ペダルを回してください。', 'ok');
}

/** 3D を試み、失敗したら 2D にフォールバックする（要件定義書 R-06） */
async function setupView() {
  const container = document.getElementById('map-stage');
  app.view?.destroy();

  if (hasApiKey()) {
    try {
      if (!app.mapsReady) {
        await loadGoogleMaps();
        app.mapsReady = true;
      }
      const view = new View3D(container, {
        rangeM: app.settings.cameraRangeM,
        tilt: app.settings.cameraTilt,
      });
      await view.init(app.route.path);
      app.view = view;
      setMapsStatus(true);

      // ストリートビューはスポット利用のみ（コスト設計上の要）
      try {
        app.streetView = new StreetViewSpot(document.getElementById('sv-stage'));
        await app.streetView.init();
      } catch {
        app.streetView = null;
      }
      return;
    } catch (err) {
      console.warn('3D 表示を初期化できませんでした:', err);
      toast('3D 表示を初期化できなかったため 2D モードで走行します', 'warn');
    }
  }

  const fb = new Fallback2D(container);
  await fb.init(app.route.path);
  app.view = fb;
  app.streetView = null;
}

let lastProfileAt = 0;

function onTick(s) {
  app.hud.update(s);
  app.view?.update(s);

  // 標高プロファイルは毎フレーム描き直す必要がない
  if (s.elapsedSec - lastProfileAt > 0.5) {
    lastProfileAt = s.elapsedSec;
    renderElevationProfile(
      document.getElementById('elevation-profile'),
      app.route.path,
      app.route.elevations,
      s.progress
    );
  }

  // 1km ごとのストリートビュー チェックポイント（要件定義書 F-206）
  if (app.streetView && app.checkpoints.shouldFire(s.distanceM)) {
    app.streetView.show(s.position, s.heading).then((ok) => {
      if (ok) setTimeout(() => app.streetView?.hide(), 6000);
    });
  }
}

function onStateChange(state) {
  const pauseBtn = document.getElementById('ride-pause');
  const startBtn = document.getElementById('ride-start');
  pauseBtn.textContent = state === RideState.PAUSED ? '再開' : '一時停止';
  pauseBtn.disabled = state === RideState.IDLE || state === RideState.FINISHED;
  startBtn.disabled = state === RideState.RIDING;
  document.getElementById('ride-finish').disabled =
    state === RideState.IDLE || state === RideState.FINISHED;
}

function togglePause() {
  if (!app.engine) return;
  if (app.engine.isRiding) app.engine.pause();
  else app.engine.start();
}

async function onFinish(summary) {
  document.getElementById('ride-stage').classList.remove('is-riding');
  try {
    await saveSession({ ...summary, routeName: app.route.name });
    toast(
      `お疲れさまでした！ ${(summary.distanceM / 1000).toFixed(2)} km / ${formatDuration(summary.elapsedSec)} / ${summary.kcal} kcal`,
      'ok'
    );
  } catch (err) {
    toast(`記録の保存に失敗しました: ${err.message}`, 'error');
  }
  await app.dashboard.refresh();
  showScreen('dashboard');
}

/* ---------------- ダッシュボード ---------------- */

function bindDashboard() {
  document.getElementById('weight-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const weight = Number(document.getElementById('weight-input').value);
    const fat = Number(document.getElementById('bodyfat-input').value);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast('体重を正しく入力してください', 'warn');
      return;
    }
    await app.dashboard.addWeight(weight, Number.isFinite(fat) && fat > 0 ? fat : null);
    toast('体重を記録しました', 'ok');
    e.target.reset();
  });

  document.getElementById('export-data').addEventListener('click', () =>
    app.dashboard.exportJson()
  );

  document.getElementById('clear-data').addEventListener('click', async () => {
    if (confirm('走行記録と体重記録をすべて削除します。取り消せません。よろしいですか？')) {
      await app.dashboard.clear();
      toast('すべてのデータを削除しました');
    }
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

init().catch((err) => {
  console.error(err);
  toast(`初期化に失敗しました: ${err.message}`, 'error');
});
