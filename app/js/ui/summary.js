/**
 * 走行完了サマリー
 *
 * 本アプリの最重要 KPI は「継続率」であり、その最大の敵は退屈である。
 * 走り終えた直後に成果がはっきり見えることは、次も乗ろうと思わせる
 * 直接的な仕掛けになる。トーストで一瞬流すのではなく、きちんと見せる。
 */

import { HEART_RATE_ZONES } from '../ride/calories.js';
import { formatDuration } from './hud.js';

export class RideSummary {
  constructor(root) {
    this.root = root;
    this.onClose = null;
    root.querySelectorAll('[data-summary-close]').forEach((btn) => {
      btn.addEventListener('click', () => this.hide());
    });
    // 背景クリックでも閉じられるように
    root.addEventListener('click', (e) => {
      if (e.target === root) this.hide();
    });
  }

  /**
   * @param {object} session 保存したセッション
   * @param {object} context {weekKcal, weekGoal, streak, isNewRecord}
   */
  show(session, context = {}) {
    const km = ((session.distanceM ?? 0) / 1000).toFixed(2);
    set(this.root, 'distance', km);
    set(this.root, 'time', formatDuration(session.elapsedSec ?? 0));
    set(this.root, 'kcal', String(session.kcal ?? 0));
    set(
      this.root,
      'kcalNote',
      session.calorieIsEstimate ? 'METs による推定値' : `パワー実測 ${session.kj} kJ`
    );
    set(this.root, 'avgPower', session.avgPowerW > 0 ? `${session.avgPowerW} W` : '--');
    set(this.root, 'avgSpeed', `${session.avgSpeedKmh ?? 0} km/h`);
    set(
      this.root,
      'avgHr',
      session.avgHeartRateBpm > 0 ? `${session.avgHeartRateBpm} bpm` : '--'
    );
    set(this.root, 'route', session.routeName ?? 'ライド');

    this._renderZones(session.zoneSeconds ?? {});
    this._renderEncouragement(session, context);

    this.root.hidden = false;
    this.root.querySelector('[data-summary-close]')?.focus();
  }

  hide() {
    this.root.hidden = true;
    this.onClose?.();
  }

  /** 心拍ゾーンの滞在時間を帯グラフで見せる（要件 F-505） */
  _renderZones(zoneSeconds) {
    const wrap = this.root.querySelector('[data-summary="zones"]');
    const empty = this.root.querySelector('[data-summary="zonesEmpty"]');
    if (!wrap) return;

    const total = Object.values(zoneSeconds).reduce((a, b) => a + b, 0);
    if (total < 1) {
      wrap.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    const bar = HEART_RATE_ZONES.map((z) => {
      const sec = zoneSeconds[z.key] ?? 0;
      const pct = (sec / total) * 100;
      return pct < 0.5
        ? ''
        : `<span class="zone-seg" style="width:${pct.toFixed(1)}%;background:${z.color}"
                 title="${z.label} ${formatDuration(sec)}"></span>`;
    }).join('');

    const legend = HEART_RATE_ZONES.filter((z) => (zoneSeconds[z.key] ?? 0) >= 1)
      .map((z) => {
        const sec = zoneSeconds[z.key] ?? 0;
        const isFatBurn = z.key === 'z2';
        return `<li${isFatBurn ? ' class="is-highlight"' : ''}>
            <span class="dot" style="background:${z.color}"></span>
            ${z.label}<strong>${formatDuration(sec)}</strong>
          </li>`;
      })
      .join('');

    const fatBurnSec = zoneSeconds.z2 ?? 0;
    wrap.innerHTML = `
      <div class="zone-bar">${bar}</div>
      <ul class="zone-legend">${legend}</ul>
      ${fatBurnSec >= 60
        ? `<p class="zone-note">脂肪燃焼ゾーン(Z2)に <strong>${formatDuration(fatBurnSec)}</strong> 滞在しました。</p>`
        : ''}
    `;
  }

  /** 継続を後押しする一言。数字だけより効く */
  _renderEncouragement(session, { weekKcal = 0, weekGoal = 0, streak = 0 } = {}) {
    const el = this.root.querySelector('[data-summary="encouragement"]');
    if (!el) return;

    const lines = [];
    if (streak >= 2) lines.push(`${streak}日連続で継続中です。`);
    if (weekGoal > 0) {
      const pct = Math.min(100, (weekKcal / weekGoal) * 100);
      if (pct >= 100) lines.push('今週の目標カロリーを達成しました。');
      else {
        const remain = Math.max(0, Math.round(weekGoal - weekKcal));
        lines.push(`今週の目標まであと ${remain.toLocaleString()} kcal です。`);
      }
    }
    // ご飯・脂肪などの身近な単位に置き換えると実感しやすい
    const kcal = session.kcal ?? 0;
    if (kcal >= 50) {
      lines.push(`今回の消費は ごはん約 ${(kcal / 234).toFixed(1)} 杯分 に相当します。`);
    }

    el.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  }
}

function set(root, key, value) {
  const el = root.querySelector(`[data-summary="${key}"]`);
  if (el) el.textContent = value;
}
