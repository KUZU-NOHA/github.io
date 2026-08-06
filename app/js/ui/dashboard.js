/**
 * ダイエットダッシュボード（要件定義書 6.5）
 *
 * 本アプリの主目的はダイエットの「継続」なので、
 * 週間カロリー・連続日数・体重推移を一目で確認できるようにする。
 */

import {
  listSessions, listWeights, saveWeight, kcalWithin, currentStreak,
  exportAll, clearAll,
} from '../store/sessions.js';
import { formatDuration } from './hud.js';

export class Dashboard {
  constructor(root, settings) {
    this.root = root;
    this.settings = settings;
  }

  async refresh() {
    const [sessions, weights] = await Promise.all([listSessions(), listWeights()]);
    this._renderStats(sessions, weights);
    this._renderWeightChart(weights);
    this._renderSessions(sessions);
  }

  _renderStats(sessions, weights) {
    const weekKcal = kcalWithin(sessions, 7);
    const monthKcal = kcalWithin(sessions, 30);
    const streak = currentStreak(sessions);
    const totalKm = sessions.reduce((s, x) => s + (x.distanceM || 0), 0) / 1000;
    const goal = this.settings.weeklyKcalGoal || 2000;
    const achieved = Math.min(100, (weekKcal / goal) * 100);

    const latest = weights[weights.length - 1];
    const first = weights[0];
    const delta = latest && first ? latest.weightKg - first.weightKg : null;

    set(this.root, 'weekKcal', Math.round(weekKcal).toLocaleString());
    set(this.root, 'weekGoal', goal.toLocaleString());
    set(this.root, 'weekAchieved', `${achieved.toFixed(0)}%`);
    set(this.root, 'monthKcal', Math.round(monthKcal).toLocaleString());
    set(this.root, 'streak', String(streak));
    // 短いライドが「0.0 km」に潰れないよう桁数を切り替える
    set(this.root, 'totalKm', totalKm < 10 ? totalKm.toFixed(2) : totalKm.toFixed(1));
    set(this.root, 'rideCount', String(sessions.length));
    set(this.root, 'currentWeight', latest ? `${latest.weightKg.toFixed(1)} kg` : '未記録');
    set(
      this.root,
      'weightDelta',
      delta === null ? '--' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg`
    );

    const bar = this.root.querySelector('[data-dash="weekBar"]');
    if (bar) bar.style.width = `${achieved.toFixed(1)}%`;
  }

  _renderWeightChart(weights) {
    const svg = this.root.querySelector('[data-dash="weightChart"]');
    const empty = this.root.querySelector('[data-dash="weightEmpty"]');
    if (!svg) return;

    if (weights.length < 2) {
      svg.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    const w = 100;
    const h = 100;
    const values = weights.map((x) => x.weightKg);
    const min = Math.min(...values, this.settings.targetWeightKg ?? Infinity);
    const max = Math.max(...values, this.settings.targetWeightKg ?? -Infinity);
    const span = Math.max(0.5, max - min);
    const y = (v) => h - ((v - min) / span) * h * 0.8 - h * 0.1;

    const pts = values
      .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(2)},${y(v).toFixed(2)}`)
      .join(' ');

    // 7日移動平均（日々の変動に埋もれた傾向を見せる）
    const ma = movingAverage(values, 7);
    const maPts = ma
      .map((v, i) => `${((i / (ma.length - 1)) * w).toFixed(2)},${y(v).toFixed(2)}`)
      .join(' ');

    const target = this.settings.targetWeightKg;
    const targetLine = Number.isFinite(target)
      ? `<line x1="0" y1="${y(target).toFixed(2)}" x2="${w}" y2="${y(target).toFixed(2)}"
               stroke="#4ade80" stroke-width="1" stroke-dasharray="3 2"
               vector-effect="non-scaling-stroke" />`
      : '';

    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML = `
      ${targetLine}
      <polyline points="${pts}" fill="none" stroke="#94a3b8" stroke-width="1"
                vector-effect="non-scaling-stroke" />
      <polyline points="${maPts}" fill="none" stroke="#38bdf8" stroke-width="2"
                vector-effect="non-scaling-stroke" />
    `;

    set(this.root, 'weightRange', `${min.toFixed(1)} 〜 ${max.toFixed(1)} kg`);
  }

  _renderSessions(sessions) {
    const list = this.root.querySelector('[data-dash="sessionList"]');
    if (!list) return;

    if (sessions.length === 0) {
      list.innerHTML =
        '<li class="empty">まだ走行記録がありません。最初のライドを始めましょう。</li>';
      return;
    }

    list.innerHTML = sessions
      .slice(0, 20)
      .map((s) => {
        const d = new Date(s.startedAt);
        const date = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const km = ((s.distanceM || 0) / 1000).toFixed(2);
        const est = s.calorieIsEstimate ? '<span class="tag">推定</span>' : '';
        return `
          <li>
            <div class="session-head">
              <strong>${escapeHtml(s.routeName || 'ライド')}</strong>
              <span class="muted">${date}</span>
            </div>
            <div class="session-stats">
              <span>${km} km</span>
              <span>${formatDuration(s.elapsedSec)}</span>
              <span>${s.kcal} kcal ${est}</span>
              ${s.avgPowerW > 0 ? `<span>平均 ${s.avgPowerW} W</span>` : ''}
            </div>
          </li>`;
      })
      .join('');
  }

  async addWeight(weightKg, bodyFatPct) {
    const date = new Date().toISOString().slice(0, 10);
    await saveWeight({ date, weightKg, bodyFatPct });
    await this.refresh();
  }

  async exportJson() {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vcycling-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async clear() {
    await clearAll();
    await this.refresh();
  }
}

function movingAverage(values, window) {
  return values.map((_, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = values.slice(from, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function set(root, key, value) {
  const el = root.querySelector(`[data-dash="${key}"]`);
  if (el) el.textContent = value;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
