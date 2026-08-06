/**
 * 走行中の HUD 表示（要件定義書 F-202 / F-203 / F-207）
 *
 * 毎フレーム呼ばれるため、DOM の参照は事前に解決し、
 * 値が変わったときだけテキストを書き換える。
 */

import { zoneFor } from '../ride/calories.js';

export class Hud {
  constructor(root, { age = 40 } = {}) {
    this.root = root;
    this.age = age;
    this.el = {
      speed: root.querySelector('[data-hud="speed"]'),
      cadence: root.querySelector('[data-hud="cadence"]'),
      power: root.querySelector('[data-hud="power"]'),
      heartRate: root.querySelector('[data-hud="heartRate"]'),
      distance: root.querySelector('[data-hud="distance"]'),
      time: root.querySelector('[data-hud="time"]'),
      grade: root.querySelector('[data-hud="grade"]'),
      kcal: root.querySelector('[data-hud="kcal"]'),
      kcalNote: root.querySelector('[data-hud="kcalNote"]'),
      zone: root.querySelector('[data-hud="zone"]'),
      progressBar: root.querySelector('[data-hud="progressBar"]'),
      progressText: root.querySelector('[data-hud="progressText"]'),
    };
    this._prev = {};
  }

  _set(key, value) {
    const el = this.el[key];
    if (!el || this._prev[key] === value) return;
    this._prev[key] = value;
    el.textContent = value;
  }

  update(s) {
    this._set('speed', s.speedKmh.toFixed(1));
    this._set('cadence', Math.round(s.cadenceRpm).toString());
    this._set('power', Math.round(s.powerW).toString());
    this._set('heartRate', s.heartRateBpm > 0 ? Math.round(s.heartRateBpm).toString() : '--');
    this._set('distance', (s.distanceM / 1000).toFixed(2));
    this._set('time', formatDuration(s.elapsedSec));
    this._set('grade', formatGrade(s.grade));
    this._set('kcal', Math.round(s.kcal).toString());

    // 推定値か実測ベースかを必ず明示する（要件定義書 F-503）
    this._set(
      'kcalNote',
      s.calorieIsEstimate ? '推定値（パワー計なし）' : `実測ベース ${Math.round(s.kj)} kJ`
    );

    const zone = zoneFor(s.heartRateBpm, this.age);
    this._set('zone', zone ? zone.label : '--');
    if (this.el.zone) {
      this.el.zone.style.color = zone ? zone.color : '';
    }

    if (this.el.progressBar) {
      this.el.progressBar.style.width = `${(s.progress * 100).toFixed(1)}%`;
    }
    this._set('progressText', `${(s.progress * 100).toFixed(0)}%`);

    // 坂道は色で直感的に分かるようにする
    if (this.el.grade) {
      this.el.grade.classList.toggle('is-climb', s.grade > 1.5);
      this.el.grade.classList.toggle('is-descent', s.grade < -1.5);
    }
  }
}

export function formatDuration(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatGrade(grade) {
  const sign = grade > 0 ? '+' : '';
  return `${sign}${grade.toFixed(1)}%`;
}

/**
 * 標高プロファイルを SVG で描き、現在位置を示す（要件定義書 F-207）。
 */
export function renderElevationProfile(svg, path, elevations, progress) {
  if (!svg || !elevations || elevations.length < 2) return;
  const w = 100;
  const h = 100;
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const span = Math.max(1, max - min);

  const points = elevations
    .map((e, i) => {
      const x = (i / (elevations.length - 1)) * w;
      const y = h - ((e - min) / span) * h * 0.85 - h * 0.08;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const cursorX = (progress * w).toFixed(2);

  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = `
    <polygon points="0,${h} ${points} ${w},${h}" fill="rgba(56,189,248,0.22)" />
    <polyline points="${points}" fill="none" stroke="#38bdf8" stroke-width="1.2"
              vector-effect="non-scaling-stroke" />
    <line x1="${cursorX}" y1="0" x2="${cursorX}" y2="${h}" stroke="#f97316"
          stroke-width="1.5" vector-effect="non-scaling-stroke" />
  `;
}
