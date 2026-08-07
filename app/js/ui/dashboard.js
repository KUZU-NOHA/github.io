/**
 * ダイエットダッシュボード（要件定義書 6.5）
 *
 * 本アプリの主目的はダイエットの「継続」なので、
 * 週間カロリー・連続日数・体重推移を一目で確認できるようにする。
 */

import {
  listSessions, listWeights, saveWeight, kcalWithin, currentStreak,
  exportAll, clearAll, zoneTotals, predictGoalDate, sessionsToCsv,
} from '../store/sessions.js';
import { HEART_RATE_ZONES } from '../ride/calories.js';
import { formatDuration } from './hud.js';

export class Dashboard {
  constructor(root, settings) {
    this.root = root;
    this.settings = settings;
  }

  async refresh() {
    const [sessions, weights] = await Promise.all([listSessions(), listWeights()]);
    this.sessions = sessions;
    this._renderStats(sessions, weights);
    this._renderZones(sessions);
    this._renderWeightChart(weights);
    this._renderGoal(weights);
    this._renderSessions(sessions);
  }

  /** 直近7日の心拍ゾーン滞在時間（要件 F-505） */
  _renderZones(sessions) {
    const wrap = this.root.querySelector('[data-dash="zones"]');
    const empty = this.root.querySelector('[data-dash="zonesEmpty"]');
    if (!wrap) return;

    const totals = zoneTotals(sessions, 7);
    const sum = Object.values(totals).reduce((a, b) => a + b, 0);

    if (sum < 1) {
      wrap.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    const bar = HEART_RATE_ZONES.map((z) => {
      const pct = ((totals[z.key] ?? 0) / sum) * 100;
      return pct < 0.5
        ? ''
        : `<span class="zone-seg" style="width:${pct.toFixed(1)}%;background:${z.color}"
                 title="${z.label} ${formatDuration(totals[z.key])}"></span>`;
    }).join('');

    const legend = HEART_RATE_ZONES.map((z) => {
      const sec = totals[z.key] ?? 0;
      if (sec < 1) return '';
      return `<li${z.key === 'z2' ? ' class="is-highlight"' : ''}>
          <span class="dot" style="background:${z.color}"></span>
          ${z.label}<strong>${formatDuration(sec)}</strong>
        </li>`;
    }).join('');

    wrap.innerHTML = `<div class="zone-bar">${bar}</div><ul class="zone-legend">${legend}</ul>`;
  }

  /** 目標体重の達成予測（要件 F-507） */
  _renderGoal(weights) {
    const el = this.root.querySelector('[data-dash="goalPrediction"]');
    if (!el) return;

    const target = this.settings.targetWeightKg;
    const r = predictGoalDate(weights, target);

    const pace = (kgPerWeek) =>
      `（現在のペース: 週 ${kgPerWeek > 0 ? '+' : ''}${kgPerWeek.toFixed(2)} kg）`;

    switch (r.status) {
      case 'ok': {
        const d = r.date;
        el.innerHTML = `目標 ${target} kg の到達予測は
          <strong>${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日ごろ</strong>
          （あと ${r.daysLeft} 日）${pace(r.kgPerWeek)}`;
        el.className = 'goal-prediction is-ok';
        break;
      }
      case 'reached':
        el.textContent = `目標 ${target} kg を達成しています。`;
        el.className = 'goal-prediction is-ok';
        break;
      case 'not-approaching':
        el.innerHTML = `現在の推移では目標に近づいていません ${pace(r.kgPerWeek)}`;
        el.className = 'goal-prediction is-warn';
        break;
      case 'too-far':
        el.innerHTML = `このペースだと達成まで2年以上かかります ${pace(r.kgPerWeek)}`;
        el.className = 'goal-prediction is-warn';
        break;
      case 'need-more-days':
        el.textContent = `予測にはあと ${r.need} 日ぶんの記録が必要です。`;
        el.className = 'goal-prediction';
        break;
      case 'need-more-data':
        el.textContent = `予測にはあと ${r.need ?? 1} 回ぶんの体重記録が必要です。`;
        el.className = 'goal-prediction';
        break;
      default:
        el.textContent = '設定画面で目標体重を入力すると達成予測が出ます。';
        el.className = 'goal-prediction';
    }
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
      .slice(0, 30)
      .map((s) => {
        const d = new Date(s.startedAt);
        const date = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const km = ((s.distanceM || 0) / 1000).toFixed(2);
        const est = s.calorieIsEstimate ? '<span class="tag">推定</span>' : '';
        return `
          <li>
            <details>
              <summary>
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
              </summary>
              ${this._sessionDetail(s)}
            </details>
          </li>`;
      })
      .join('');
  }

  _sessionDetail(s) {
    const rows = [
      ['平均速度', s.avgSpeedKmh > 0 ? `${s.avgSpeedKmh} km/h` : '--'],
      ['最高速度', s.maxSpeedKmh > 0 ? `${s.maxSpeedKmh} km/h` : '--'],
      ['平均パワー', s.avgPowerW > 0 ? `${s.avgPowerW} W` : '--'],
      ['最大パワー', s.maxPowerW > 0 ? `${s.maxPowerW} W` : '--'],
      ['平均心拍', s.avgHeartRateBpm > 0 ? `${s.avgHeartRateBpm} bpm` : '--'],
      ['カロリー算出', s.calorieIsEstimate ? 'METs による推定' : `パワー実測 ${s.kj ?? 0} kJ`],
    ];

    const zoneTotal = Object.values(s.zoneSeconds ?? {}).reduce((a, b) => a + b, 0);
    const zones = zoneTotal >= 1
      ? `<div class="zone-bar">${HEART_RATE_ZONES.map((z) => {
          const pct = ((s.zoneSeconds[z.key] ?? 0) / zoneTotal) * 100;
          return pct < 0.5 ? ''
            : `<span class="zone-seg" style="width:${pct.toFixed(1)}%;background:${z.color}"
                     title="${z.label} ${formatDuration(s.zoneSeconds[z.key])}"></span>`;
        }).join('')}</div>`
      : '<p class="muted">心拍データがありません</p>';

    return `<div class="session-detail">
        <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        ${zones}
      </div>`;
  }

  async addWeight(weightKg, bodyFatPct) {
    const date = new Date().toISOString().slice(0, 10);
    await saveWeight({ date, weightKg, bodyFatPct });
    await this.refresh();
  }

  async exportJson() {
    const data = await exportAll();
    download(
      JSON.stringify(data, null, 2),
      'application/json',
      `vcycling-${today()}.json`
    );
  }

  /** 表計算ソフトで開ける形式。Excel のために BOM を付ける */
  async exportCsv() {
    const sessions = await listSessions();
    download(
      `﻿${sessionsToCsv(sessions)}`,
      'text/csv;charset=utf-8',
      `vcycling-${today()}.csv`
    );
  }

  async clear() {
    await clearAll();
    await this.refresh();
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function download(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
