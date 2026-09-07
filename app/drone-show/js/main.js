// 画面全体の状態管理と UI 配線。

import { FORMATIONS, defaultParams } from './formations.js';
import {
  defaultShow, makeKeyframe, compileShow, sampleAt, segmentAt,
  EASINGS, COLOR_MODES, hexToRgb, rgbToHex,
} from './show.js';
import { validateShow } from './validate.js';
import { Viewer } from './viewer.js';
import {
  sampleTrajectories, toCsv, toTrajectoryJson, toProjectJson,
  parseProjectJson, toLaunchPositionsCsv, download, safeFilename,
} from './exporters.js';

const $ = (id) => document.getElementById(id);

const state = {
  show: defaultShow(),
  compiled: null,
  selected: 0,
  time: 0,
  playing: false,
  speed: 1,
  validation: null,
  frameBuf: null,
};

const viewer = new Viewer($('view'));

// --- 再計算 -----------------------------------------------------------------

let recomputeTimer = null;

function scheduleRecompute() {
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(recompute, 120);
}

function recompute() {
  state.show.droneCount = clampInt(state.show.droneCount, 1, 500);
  state.compiled = compileShow(state.show);
  state.time = Math.min(state.time, state.compiled.timeline.duration);
  // 振り付けが変われば以前の検証結果は無効
  state.validation = null;
  viewer.options.geofenceRadius = state.show.limits.geofenceRadius;
  viewer.options.maxAltitude = state.show.limits.maxAltitude;
  viewer.setHighlight([]);
  state.frameBuf = null;
  viewer.clearTrails();
  renderVerdict();
  renderChecks();
  renderKeyframeList();
  renderStats();
  renderFrame(true);
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// --- 描画 -------------------------------------------------------------------

function renderFrame(resetTrails = false) {
  const c = state.compiled;
  if (!c) return;
  state.frameBuf = sampleAt(c, state.time, state.frameBuf ?? undefined);
  viewer.setFrame(state.frameBuf, resetTrails);
  viewer.render();

  const dur = c.timeline.duration;
  $('timeLabel').textContent = `${state.time.toFixed(1)} / ${dur.toFixed(1)} s`;
  const scrub = $('scrub');
  if (document.activeElement !== scrub) {
    scrub.value = String(dur > 0 ? Math.round((state.time / dur) * 1000) : 0);
  }

  const seg = segmentAt(c, state.time);
  const kf = state.show.keyframes[seg.k];
  $('segLabel').textContent =
    seg.kind === 'hold' ? `静止: ${kf.name}` : `遷移: ${kf.name} → ${state.show.keyframes[seg.k + 1].name}`;

  document.querySelectorAll('.kf').forEach((el, i) => {
    el.classList.toggle('playing', i === seg.k);
  });
}

function renderStats() {
  const c = state.compiled;
  const dur = c.timeline.duration;
  const samples = Math.ceil(dur * state.show.exportFps) + 1;
  $('statDuration').textContent = `${dur.toFixed(1)} s（${(dur / 60).toFixed(1)} 分）`;
  $('statSamples').textContent = `${samples} × ${state.show.droneCount} 機`;
  $('showSummary').textContent =
    `${state.show.droneCount} 機 / ${state.show.keyframes.length} 隊列 / ${dur.toFixed(0)} 秒`;
}

function renderKeyframeList() {
  const list = $('kfList');
  list.innerHTML = '';
  state.show.keyframes.forEach((kf, i) => {
    const el = document.createElement('div');
    el.className = 'kf' + (i === state.selected ? ' selected' : '');
    const tail = i < state.show.keyframes.length - 1 ? ` → ${kf.transition}s` : '';
    el.innerHTML = `
      <span class="idx">${i + 1}</span>
      <span class="swatch" style="background:${kf.colorMode === 'rainbow' || kf.colorMode === 'radial'
        ? 'linear-gradient(90deg,#ff4d4d,#ffd400,#3ddc97,#34d0ff,#a855f7)'
        : kf.colorA}"></span>
      <span class="body">
        <span class="name"></span>
        <span class="meta">${FORMATIONS[kf.type].label} ・ ${kf.hold}s${tail}</span>
      </span>`;
    el.querySelector('.name').textContent = kf.name;
    el.addEventListener('click', () => {
      state.selected = i;
      renderKeyframeList();
      renderEditor();
      // 選択した隊列の静止区間へ頭出し
      const segs = state.compiled.timeline.segs;
      const seg = segs.find((s) => s.kind === 'hold' && s.k === i);
      if (seg) {
        state.time = (seg.t0 + seg.t1) / 2;
        renderFrame(true);
      }
    });
    list.appendChild(el);
  });
}

function field(label, inputHtml, hint) {
  return `<div class="field"><label>${label}</label>${inputHtml}${
    hint ? `<div class="hint" style="margin-top:3px">${hint}</div>` : ''
  }</div>`;
}

function renderEditor() {
  const kf = state.show.keyframes[state.selected];
  const box = $('kfEditor');
  if (!kf) { box.innerHTML = ''; return; }

  const isLast = state.selected === state.show.keyframes.length - 1;
  const def = FORMATIONS[kf.type];
  const params = { ...defaultParams(kf.type), ...kf.params };

  const typeOptions = Object.entries(FORMATIONS)
    .map(([k, v]) => `<option value="${k}"${k === kf.type ? ' selected' : ''}>${v.label}</option>`)
    .join('');
  const easeOptions = Object.entries(EASINGS)
    .map(([k, v]) => `<option value="${k}"${k === kf.easing ? ' selected' : ''}>${v.label}</option>`)
    .join('');
  const colorOptions = Object.entries(COLOR_MODES)
    .map(([k, v]) => `<option value="${k}"${k === kf.colorMode ? ' selected' : ''}>${v.label}</option>`)
    .join('');

  const paramFields = def.params
    .map((p) => {
      if (p.type === 'text') {
        return field(
          p.label,
          `<input data-param="${p.key}" type="text" value="${escapeAttr(params[p.key])}">`,
        );
      }
      return field(
        p.label,
        `<input data-param="${p.key}" type="number" min="${p.min}" max="${p.max}" step="${p.step}" value="${params[p.key]}">`,
      );
    })
    .join('');

  const needsB = COLOR_MODES[kf.colorMode].colors === 2;
  const needsA = COLOR_MODES[kf.colorMode].colors >= 1;

  box.innerHTML = `
    ${field('名前', `<input data-k="name" type="text" value="${escapeAttr(kf.name)}">`)}
    ${field('隊列の種類', `<select data-k="type">${typeOptions}</select>`, def.hint || '')}
    <div class="grid2">${paramFields}</div>
    <div class="grid2">
      ${field('静止 [秒]', `<input data-k="hold" type="number" min="0" max="120" step="0.5" value="${kf.hold}">`)}
      ${isLast ? '' : field('次への遷移 [秒]', `<input data-k="transition" type="number" min="0.5" max="120" step="0.5" value="${kf.transition}">`)}
    </div>
    ${isLast ? '' : field('遷移カーブ', `<select data-k="easing">${easeOptions}</select>`,
      '「スムーズ」は始終端で速度 0 になり、機体に優しい。「等速」は加速度が無限大になるため実機では非推奨。')}
    ${field('発色', `<select data-k="colorMode">${colorOptions}</select>`)}
    <div class="grid2">
      ${needsA ? field('色 A', `<input data-k="colorA" type="color" value="${kf.colorA}">`) : ''}
      ${needsB ? field('色 B', `<input data-k="colorB" type="color" value="${kf.colorB}">`) : ''}
    </div>`;

  box.querySelectorAll('[data-k]').forEach((el) => {
    el.addEventListener('input', () => {
      const key = el.dataset.k;
      let v = el.value;
      if (['hold', 'transition'].includes(key)) v = Number(v) || 0;
      kf[key] = v;
      if (key === 'type') {
        kf.params = defaultParams(v);
        renderEditor();
      }
      if (key === 'colorMode') renderEditor();
      renderKeyframeList();
      scheduleRecompute();
    });
  });

  box.querySelectorAll('[data-param]').forEach((el) => {
    el.addEventListener('input', () => {
      const key = el.dataset.param;
      kf.params = { ...params, ...kf.params };
      kf.params[key] = el.type === 'number' ? Number(el.value) : el.value;
      scheduleRecompute();
    });
  });
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// --- 検証 -------------------------------------------------------------------

function renderVerdict(running = false) {
  const el = $('verdict');
  if (running) {
    el.className = 'verdict idle';
    el.textContent = '検証中…';
    return;
  }
  const v = state.validation;
  if (!v) {
    el.className = 'verdict idle';
    el.textContent = '未検証。書き出し前に必ず実行すること。';
    return;
  }
  el.className = `verdict ${v.passed ? 'ok' : 'ng'}`;
  el.textContent = v.passed
    ? `合格：全 ${v.checks.length} 項目クリア（最小機体間距離 ${v.minDistance.toFixed(2)} m）`
    : `不合格：${v.checks.filter((c) => !c.ok).length} 項目が基準外。実機へアップロードしないこと。`;
}

function renderChecks() {
  const box = $('checkList');
  box.innerHTML = '';
  const v = state.validation;
  if (!v) return;
  for (const c of v.checks) {
    const el = document.createElement('div');
    el.className = 'check';
    el.innerHTML = `
      <span class="badge ${c.ok ? 'ok' : 'ng'}">${c.ok ? '✓' : '!'}</span>
      <span><span class="label"></span><br><span class="detail"></span></span>`;
    el.querySelector('.label').textContent = c.label;
    el.querySelector('.detail').textContent = c.detail;
    box.appendChild(el);
  }
}

async function runValidation() {
  const btn = $('validateBtn');
  btn.disabled = true;
  renderVerdict(true);
  const bar = $('validateProgress');
  try {
    const result = await validateShow(state.compiled, {
      sampleFps: 10,
      onProgress: (p) => { bar.style.width = `${(p * 100).toFixed(0)}%`; },
    });
    state.validation = result;
    // 最接近ペアを 3D ビューで強調し、その瞬間へ頭出しする
    const sep = result.checks.find((c) => c.id === 'separation');
    if (sep && !sep.ok) {
      const m = /機体 #(\d+) と #(\d+)/.exec(sep.detail);
      const tm = /t=([\d.]+)s/.exec(sep.detail);
      if (m) viewer.setHighlight([Number(m[1]) - 1, Number(m[2]) - 1]);
      if (tm) { state.time = Number(tm[1]); }
    }
  } catch (e) {
    state.validation = null;
    $('verdict').className = 'verdict ng';
    $('verdict').textContent = `検証に失敗: ${e.message}`;
  } finally {
    btn.disabled = false;
    bar.style.width = '0%';
    renderVerdict();
    renderChecks();
    renderFrame(true);
  }
}

// --- 再生 -------------------------------------------------------------------

let lastTick = 0;

function tick(now) {
  requestAnimationFrame(tick);
  const dt = lastTick ? (now - lastTick) / 1000 : 0;
  lastTick = now;
  if (!state.playing || !state.compiled) return;
  const dur = state.compiled.timeline.duration;
  state.time += dt * state.speed;
  if (state.time >= dur) {
    state.time = dur;
    setPlaying(false);
  }
  renderFrame();
}

function setPlaying(on) {
  state.playing = on;
  $('playBtn').textContent = on ? '⏸ 一時停止' : '▶ 再生';
  $('playBtn').classList.toggle('primary', !on);
}

// --- 入力の配線 -------------------------------------------------------------

function bindShowInputs() {
  const bind = (id, apply, isNum = true) => {
    const el = $(id);
    el.addEventListener('input', () => {
      apply(isNum ? Number(el.value) : el.value);
      scheduleRecompute();
    });
  };
  bind('showName', (v) => { state.show.name = v; }, false);
  bind('droneCount', (v) => { state.show.droneCount = v; });
  bind('exportFps', (v) => { state.show.exportFps = Math.max(1, Math.min(30, v || 10)); });
  bind('limSafety', (v) => { state.show.limits.safetyDistance = v; });
  bind('limSpeed', (v) => { state.show.limits.maxSpeed = v; });
  bind('limAccel', (v) => { state.show.limits.maxAccel = v; });
  bind('limAlt', (v) => { state.show.limits.maxAltitude = v; });
  bind('limMinAlt', (v) => { state.show.limits.minFlightAltitude = v; });
  bind('limFence', (v) => { state.show.limits.geofenceRadius = v; });
  bind('limBattery', (v) => { state.show.limits.batteryMinutes = v; });
}

function fillShowInputs() {
  const s = state.show;
  $('showName').value = s.name;
  $('droneCount').value = s.droneCount;
  $('exportFps').value = s.exportFps;
  $('limSafety').value = s.limits.safetyDistance;
  $('limSpeed').value = s.limits.maxSpeed;
  $('limAccel').value = s.limits.maxAccel;
  $('limAlt').value = s.limits.maxAltitude;
  $('limMinAlt').value = s.limits.minFlightAltitude;
  $('limFence').value = s.limits.geofenceRadius;
  $('limBattery').value = s.limits.batteryMinutes;
}

function bindKeyframeButtons() {
  $('kfAdd').addEventListener('click', () => {
    const kf = makeKeyframe({ params: defaultParams('circle') });
    state.show.keyframes.splice(state.selected + 1, 0, kf);
    state.selected += 1;
    recompute();
    renderEditor();
  });
  $('kfDup').addEventListener('click', () => {
    const src = state.show.keyframes[state.selected];
    const copy = JSON.parse(JSON.stringify(src));
    copy.name = `${src.name} のコピー`;
    state.show.keyframes.splice(state.selected + 1, 0, copy);
    state.selected += 1;
    recompute();
    renderEditor();
  });
  $('kfDel').addEventListener('click', () => {
    if (state.show.keyframes.length <= 2) {
      alert('キーフレームは 2 つ以上必要です。');
      return;
    }
    state.show.keyframes.splice(state.selected, 1);
    state.selected = Math.max(0, state.selected - 1);
    recompute();
    renderEditor();
  });
  const move = (delta) => {
    const i = state.selected;
    const j = i + delta;
    if (j < 0 || j >= state.show.keyframes.length) return;
    const kfs = state.show.keyframes;
    [kfs[i], kfs[j]] = [kfs[j], kfs[i]];
    state.selected = j;
    recompute();
    renderEditor();
  };
  $('kfUp').addEventListener('click', () => move(-1));
  $('kfDown').addEventListener('click', () => move(1));
}

function bindTransport() {
  $('playBtn').addEventListener('click', () => {
    if (!state.playing && state.time >= state.compiled.timeline.duration) {
      state.time = 0;
      viewer.clearTrails();
    }
    setPlaying(!state.playing);
  });
  $('scrub').addEventListener('input', (e) => {
    const dur = state.compiled.timeline.duration;
    state.time = (Number(e.target.value) / 1000) * dur;
    viewer.clearTrails();
    renderFrame();
  });
  $('speedSel').addEventListener('change', (e) => { state.speed = Number(e.target.value); });
}

function bindViewControls() {
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewer.setView(btn.dataset.view);
      document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b === btn));
      viewer.render();
    });
  });
  document.querySelector('[data-view="audience"]').classList.add('on');

  const toggle = (id, key) => {
    const btn = $(id);
    btn.classList.toggle('on', viewer.options[key]);
    btn.addEventListener('click', () => {
      viewer.options[key] = !viewer.options[key];
      btn.classList.toggle('on', viewer.options[key]);
      if (key === 'showTrails') viewer.clearTrails();
      viewer.render();
    });
  };
  toggle('toggleTrails', 'showTrails');
  toggle('toggleGrid', 'showGrid');
  toggle('toggleFence', 'showGeofence');
}

function bindExport() {
  const base = () => safeFilename(state.show.name);

  $('exportCsv').addEventListener('click', () => {
    const sampled = sampleTrajectories(state.compiled, state.show.exportFps);
    download(`${base()}_trajectory.csv`, toCsv(state.compiled, sampled), 'text/csv');
  });
  $('exportJson').addEventListener('click', () => {
    const sampled = sampleTrajectories(state.compiled, state.show.exportFps);
    download(
      `${base()}_trajectory.json`,
      toTrajectoryJson(state.compiled, sampled, state.validation),
      'application/json',
    );
  });
  $('exportLaunch').addEventListener('click', () => {
    download(`${base()}_launch_positions.csv`, toLaunchPositionsCsv(state.compiled), 'text/csv');
  });
  $('exportProject').addEventListener('click', () => {
    download(`${base()}_project.json`, toProjectJson(state.show), 'application/json');
  });

  $('importProject').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const show = parseProjectJson(await file.text());
      state.show = show;
      state.selected = 0;
      state.time = 0;
      fillShowInputs();
      recompute();
      renderEditor();
    } catch (err) {
      alert(`読み込みに失敗しました: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  });

  $('resetShow').addEventListener('click', () => {
    if (!confirm('編集内容を破棄してサンプルショーに戻しますか？')) return;
    state.show = defaultShow();
    state.selected = 0;
    state.time = 0;
    fillShowInputs();
    recompute();
    renderEditor();
  });
}

// --- 起動 -------------------------------------------------------------------

function init() {
  fillShowInputs();
  bindShowInputs();
  bindKeyframeButtons();
  bindTransport();
  bindViewControls();
  bindExport();
  $('validateBtn').addEventListener('click', runValidation);

  window.addEventListener('resize', () => {
    viewer.resize();
    viewer.render();
  });

  recompute();
  renderEditor();
  requestAnimationFrame(tick);
}

init();

// デバッグ・自動テスト用
window.__droneShow = { state, viewer, recompute };
