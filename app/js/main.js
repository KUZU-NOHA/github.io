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
  PRESET_ROUTES, fetchRoute, fetchElevations, routeFromPresetRefined, routeFromGpxFile,
} from './map/route.js';
import { View3D } from './map/view3d.js';
import { Fallback2D } from './map/fallback2d.js';
import { StreetViewSpot, CheckpointTracker } from './map/streetview.js';
import { BikeSensor, diagnoseDevice } from './ble/bike.js';
import { HeartRateMonitor } from './ble/heartRate.js';
import { SimulatedTrainer } from './ble/simulator.js';
import { RideEngine, RideState } from './ride/engine.js';
import { Hud, renderElevationProfile, formatDuration } from './ui/hud.js';
import { Dashboard } from './ui/dashboard.js';
import { RideSummary } from './ui/summary.js';
import {
  saveSession, listSessions, kcalWithin, currentStreak,
  saveRoute, listRoutes, deleteRoute, routeKeyFor, bestGhostFor,
} from './store/sessions.js';

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
  app.summary = new RideSummary(document.getElementById('ride-summary'));
  app.summary.onClose = () => showScreen('dashboard');

  bindNav();
  bindSetup();
  bindRouteScreen();
  bindRideScreen();
  bindDashboard();
  bindFullscreen();
  renderSettingsForm();
  renderPresets();
  renderFavorites();
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
      if (field.type === 'checkbox') {
        app.settings[key] = field.checked;
      } else if (typeof DEFAULT_SETTINGS[key] === 'string') {
        // select など文字列の設定は数値化しない
        app.settings[key] = field.value;
      } else {
        app.settings[key] = coerceNumber(field.value);
      }
    }
    saveSettings(app.settings);
    // 走行中でも即座に反映する
    if (app.engine) {
      app.engine.speedMultiplier = app.settings.speedMultiplier;
      app.engine.gradeEnabled = app.settings.gradeEnabled;
      app.engine.age = app.settings.age;
    }
    if (app.source && !app.source.isSimulated) {
      app.source.speedSource = app.settings.speedSource;
      app.source.wheelCircumferenceMm = app.settings.wheelCircumferenceMm;
      app.source.bikeProfile = app.settings.bikeProfile;
      app.source.totalMassKg = app.settings.weightKg + 9;
      // 算出条件を変えたら平滑化の履歴も捨てる
      app.source._speedSmoother?.reset();
      document.getElementById('source-status').textContent = app.source.description;
      // Wahoo 制御は転がり抵抗・空気抵抗を別コマンドで保持しているため、
      // 車種プロファイルを変えたらトレーナー側にも再送して反映する
      app.source._sendWahooSimMode?.().catch(() => {});
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
      setRouteBusy(true);
      try {
        await selectRoute(await routeFromPresetRefined(preset));
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setRouteBusy(false);
      }
    });
  });
}

function bindRouteScreen() {
  document.getElementById('route-favorite').addEventListener('click', openFavoriteSaveForm);
  document.getElementById('favorite-save-cancel').addEventListener('click', closeFavoriteSaveForm);
  document.getElementById('favorite-save-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveCurrentRouteAsFavorite(document.getElementById('favorite-name-input').value);
  });

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
    // ゴースト走行で「同じルートを過去に走ったか」を判定するためのキー。
    // お気に入り保存済みルートを選び直した場合はそちらの id を優先する
    routeKey: routeKeyFor(path),
    favoriteId: result.favoriteId ?? null,
  };

  const km = (path.totalDistanceM / 1000).toFixed(2);
  const climb = totalClimb(elevations);
  document.getElementById('route-summary').innerHTML = `
    <strong>${escapeHtml(app.route.name)}</strong>
    <span>${km} km</span>
    ${elevations.length ? `<span>獲得標高 ${Math.round(climb)} m</span>` : '<span class="muted">標高データなし</span>'}
  `;
  document.getElementById('route-ready').hidden = false;

  document.getElementById('favorite-save-form').hidden = true;
  const favBtn = document.getElementById('route-favorite');
  favBtn.hidden = !!app.route.favoriteId; // 既にお気に入りなら再保存ボタンは不要
  favBtn.disabled = false;

  if (app.route.warning) toast(app.route.warning, 'warn');
  else toast(`ルートを設定しました（${km} km）`, 'ok');
}

function openFavoriteSaveForm() {
  if (!app.route) return;
  document.getElementById('favorite-name-input').value = app.route.name;
  document.getElementById('favorite-save-form').hidden = false;
  document.getElementById('route-favorite').hidden = true;
  document.getElementById('favorite-name-input').focus();
}

function closeFavoriteSaveForm() {
  document.getElementById('favorite-save-form').hidden = true;
  // 既にお気に入り済みのルートでなければボタンを再表示する
  document.getElementById('route-favorite').hidden = !!app.route?.favoriteId;
}

async function saveCurrentRouteAsFavorite(name) {
  if (!app.route) return;
  const trimmed = (name ?? '').trim();
  if (!trimmed) {
    toast('ルート名を入力してください', 'warn');
    return;
  }

  try {
    const id = await saveRoute({
      name: trimmed,
      path: app.route.path,
      elevations: app.route.elevations,
      loop: app.route.loop,
    });
    app.route.favoriteId = id;
    document.getElementById('favorite-save-form').hidden = true;
    toast('お気に入りに保存しました', 'ok');
    await renderFavorites();
  } catch (err) {
    toast(`保存に失敗しました: ${err.message}`, 'error');
  }
}

async function renderFavorites() {
  const wrap = document.getElementById('favorite-list');
  const empty = document.getElementById('favorite-empty');
  const favorites = await listRoutes();

  if (favorites.length === 0) {
    wrap.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  wrap.innerHTML = favorites
    .map((r) => {
      const km = (r.path.totalDistanceM / 1000).toFixed(2);
      return `
        <li>
          <button type="button" class="preset" data-favorite="${r.id}">
            <strong>${escapeHtml(r.name)}</strong>
            <span class="muted">${km} km${r.loop ? '・周回' : ''}</span>
          </button>
          <button type="button" class="icon-btn" data-favorite-delete="${r.id}" aria-label="削除">×</button>
        </li>`;
    })
    .join('');

  wrap.querySelectorAll('[data-favorite]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const r = favorites.find((x) => x.id === Number(btn.dataset.favorite));
      if (!r) return;
      await selectRoute({
        path: r.path,
        elevations: r.elevations,
        name: r.name,
        loop: r.loop,
        favoriteId: r.id,
      });
    });
  });

  wrap.querySelectorAll('[data-favorite-delete]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.favoriteDelete);
      if (confirm('このお気に入りルートを削除しますか？')) {
        await deleteRoute(id);
        await renderFavorites();
      }
    });
  });
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
      speedSource: app.settings.speedSource,
      bikeProfile: app.settings.bikeProfile,
    });
    await bike.connect({ acceptAll });
    setSource(bike);
    toast(`${bike.name} に接続しました — ${bike.description}`, 'ok');

    // 接続直後は何が取れるか未確定なので、数秒後に説明を更新する
    setTimeout(() => {
      if (app.source === bike) {
        document.getElementById('source-status').textContent = bike.description;
      }
    }, 4000);
  } catch (err) {
    // ユーザーがダイアログを閉じただけのケースは通常のフローなので騒がない
    if (err.name === 'NotFoundError' && /cancel|User cancelled/i.test(err.message)) {
      return;
    }
    toast(`接続に失敗しました: ${err.message}`, 'error');
  }
}

/**
 * デバイスが何に対応しているかを調べて画面に出す。
 * 「繋がるのにデータが来ない」機種の切り分け用。
 */
async function runDiagnosis() {
  const box = document.getElementById('diagnosis-result');
  box.hidden = false;
  box.textContent = '接続して調査中…';

  try {
    const result = await diagnoseDevice(true);
    const lines = [`デバイス名: ${result.name}`, ''];

    if (result.services.length === 0) {
      lines.push('既知のサービスは見つかりませんでした。');
      lines.push('メーカー独自プロトコルのみの機種と思われます。');
    } else {
      for (const s of result.services) {
        lines.push(`■ ${s.label}`);
        lines.push(`  ${s.uuid}`);
        for (const c of s.characteristics) {
          lines.push(`   - ${shortUuid(c.uuid)} [${c.properties.join(',')}]`);
        }
        lines.push('');
      }
    }

    const text = lines.join('\n');
    box.innerHTML = '';
    const pre = document.createElement('pre');
    pre.textContent = text;
    const copy = document.createElement('button');
    copy.textContent = 'この結果をコピー';
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(
        () => toast('コピーしました', 'ok'),
        () => toast('コピーに失敗しました。手動で選択してください', 'warn')
      );
    });
    box.append(pre, copy);
  } catch (err) {
    if (err.name === 'NotFoundError' && /cancel|User cancelled/i.test(err.message)) {
      box.hidden = true;
      return;
    }
    box.textContent = `診断に失敗しました: ${err.message}`;
  }
}

/** 128bit に正規化された UUID を、標準サービスなら短い表記に戻す */
function shortUuid(uuid) {
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i.exec(uuid);
  return m ? `0x${m[1].toUpperCase()}` : uuid;
}

function updateBleAvailability() {
  const supported = BikeSensor.isSupported;
  const note = document.getElementById('ble-note');
  document.getElementById('connect-trainer').disabled = !supported;
  document.getElementById('connect-any').disabled = !supported;
  document.getElementById('connect-hr').disabled = !supported;
  document.getElementById('diagnose-device').disabled = !supported;
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
  document.getElementById('diagnose-device').addEventListener('click', runDiagnosis);

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
  // 一時停止・終了は、全画面表示中に ride-side（サイドパネル）が隠れても
  // 操作できるよう、映像上のボタン（hud-pause / hud-finish）にも同じ処理を割り当てる
  document.getElementById('ride-pause').addEventListener('click', togglePause);
  document.getElementById('hud-pause').addEventListener('click', togglePause);
  document.getElementById('ride-finish').addEventListener('click', finishRide);
  document.getElementById('hud-finish').addEventListener('click', finishRide);

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

  // 同じルートを過去に走っていれば、その中で最速のものをゴーストにする
  const ghost = app.route.loop
    ? null
    : bestGhostFor(await listSessions(), app.route.routeKey);

  app.engine = new RideEngine({
    path: app.route.path,
    elevations: app.route.elevations,
    source: app.source,
    weightKg: app.settings.weightKg,
    age: app.settings.age,
    speedMultiplier: app.settings.speedMultiplier,
    gradeEnabled: app.settings.gradeEnabled,
    loop: app.route.loop,
    ghost,
  });

  app.engine.addEventListener('tick', (e) => onTick(e.detail));
  app.engine.addEventListener('statechange', (e) => onStateChange(e.detail));
  app.engine.addEventListener('finish', (e) => onFinish(e.detail));

  app.engine.start();
  document.getElementById('ride-stage').classList.add('is-riding');
  toast(
    ghost
      ? `走行を開始しました。前回のタイム（${formatDuration(ghost.elapsedSec)}）と比較します。`
      : '走行を開始しました。ペダルを回してください。',
    'ok'
  );
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
  const isIdleOrFinished = state === RideState.IDLE || state === RideState.FINISHED;
  const pauseLabel = state === RideState.PAUSED ? '再開' : '一時停止';

  const pauseBtn = document.getElementById('ride-pause');
  const startBtn = document.getElementById('ride-start');
  pauseBtn.textContent = pauseLabel;
  pauseBtn.disabled = isIdleOrFinished;
  startBtn.disabled = state === RideState.RIDING;
  document.getElementById('ride-finish').disabled = isIdleOrFinished;

  // 映像上の複製ボタン（全画面表示中に使う）も同期する
  const hudPauseBtn = document.getElementById('hud-pause');
  hudPauseBtn.disabled = isIdleOrFinished;
  hudPauseBtn.textContent = state === RideState.PAUSED ? '▶' : '⏸';
  hudPauseBtn.setAttribute('aria-label', pauseLabel);
  document.getElementById('hud-finish').disabled = isIdleOrFinished;
}

function togglePause() {
  if (!app.engine) return;
  if (app.engine.isRiding) app.engine.pause();
  else app.engine.start();
}

function finishRide() {
  if (app.engine && confirm('走行を終了して記録を保存しますか？')) {
    app.engine.finish();
  }
}

/**
 * 映像+HUD部分（ride-stage）だけを全画面表示にする。
 * サイドパネル(ride-side)は全画面中は見えなくなるため、最低限の操作
 * （一時停止・終了）は HUD 上のボタンに複製してある（onStateChange 参照）。
 */
function bindFullscreen() {
  const stage = document.getElementById('ride-stage');
  const btn = document.getElementById('fullscreen-toggle');

  if (!document.fullscreenEnabled) {
    // Safari 等、Fullscreen API 非対応環境ではボタンごと隠す
    btn.hidden = true;
    return;
  }

  const toggle = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      stage.requestFullscreen().catch((err) => {
        toast(`全画面表示にできませんでした: ${err.message}`, 'warn');
      });
    }
  };

  btn.addEventListener('click', toggle);

  document.addEventListener('fullscreenchange', () => {
    const isFull = document.fullscreenElement === stage;
    btn.textContent = isFull ? '⤢' : '⛶';
    btn.title = isFull ? '全画面を解除 (F)' : '全画面表示 (F)';
    btn.setAttribute('aria-label', isFull ? '全画面を解除' : '全画面表示');

    // Fallback2D の canvas はピクセル単位でサイズを保持しており、
    // window の resize イベントで更新される。フルスクリーン切替時に
    // このイベントが確実に発火するとは限らないため明示的に発火させる。
    // レイアウト確定後に呼びたいので1フレーム待つ
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });

  // F キーですぐ切り替えられるようにする（走行画面表示中のみ、
  // 入力欄にフォーカスがあるときは通常の文字入力を優先する）
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.getElementById('screen-ride').hidden) return;
    const el = document.activeElement;
    const isTyping = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    if (isTyping) return;
    e.preventDefault();
    toggle();
  });
}

async function onFinish(summary) {
  document.getElementById('ride-stage').classList.remove('is-riding');
  // 走行完了サマリーは ride-stage の外側にあるため、全画面表示のままだと
  // 隠れて見えなくなる。終了時は必ず解除しておく
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
  }
  const session = {
    ...summary,
    routeName: app.route.name,
    routeKey: app.route.routeKey,
  };

  let savedId = null;
  try {
    savedId = await saveSession(session);
  } catch (err) {
    toast(`記録の保存に失敗しました: ${err.message}`, 'error');
  }

  await app.dashboard.refresh();

  // 走り終えた直後に成果を見せる。継続率に直接効く場面なので、
  // トーストで流さずきちんと出す
  try {
    const sessions = await listSessions();
    const ghost = !app.route.loop
      ? bestGhostFor(sessions, session.routeKey, savedId)
      : null;
    app.summary.show(session, {
      weekKcal: kcalWithin(sessions, 7),
      weekGoal: app.settings.weeklyKcalGoal,
      streak: currentStreak(sessions),
      ghost,
    });
  } catch {
    // サマリーが出せなくても記録は残っているので致命的ではない
    toast(
      `お疲れさまでした！ ${(summary.distanceM / 1000).toFixed(2)} km / ${formatDuration(summary.elapsedSec)} / ${summary.kcal} kcal`,
      'ok'
    );
    showScreen('dashboard');
  }
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

  document.getElementById('export-csv').addEventListener('click', () =>
    app.dashboard.exportCsv()
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
