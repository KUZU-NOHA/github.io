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
      speedNote: root.querySelector('[data-hud="speedNote"]'),
      ghost: root.querySelector('[data-hud="ghost"]'),
      ghostRow: root.querySelector('[data-hud="ghostRow"]'),
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

    // 倍率を使っているときは、実測との差が分かるようにしておく
    this._set(
      'speedNote',
      s.speedMultiplier > 1
        ? `×${s.speedMultiplier} (実測 ${s.rawSpeedKmh.toFixed(1)})`
        : ''
    );
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

    this._updateGhost(s);
  }

  /** 前回この道を走ったときとの差分を出す。先行/遅れが一目で分かるようにする */
  _updateGhost(s) {
    if (!this.el.ghostRow) return;

    if (!s.hasGhost) {
      this.el.ghostRow.hidden = true;
      return;
    }
    this.el.ghostRow.hidden = false;

    if (s.ghostDeltaSec === null) {
      this._set('ghost', '--');
      return;
    }
    // 負値＝前回より速い（先行）。プラス表示は「遅れ」で直感的に一致させる
    const ahead = s.ghostDeltaSec < 0;
    const abs = formatDuration(Math.abs(s.ghostDeltaSec));
    this._set('ghost', `${ahead ? '−' : '+'}${abs}`);
    if (this.el.ghost) {
      this.el.ghost.classList.toggle('is-ahead', ahead);
      this.el.ghost.classList.toggle('is-behind', !ahead);
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
/**
 * 区間の勾配[%]から色を決める。他社アプリの勾配表示（登り区間ほど暖色）に
 * 寄せた5段階。HUDの is-climb/is-descent（急坂の色）と揃えている。
 */
export function gradeColor(grade) {
  if (grade <= -3) return '#38bdf8'; // 下り
  if (grade < 2) return '#94a3b8'; // 平坦
  if (grade < 5) return '#facc15'; // 中程度の登り
  if (grade < 8) return '#fb923c'; // 急な登り
  return '#f87171'; // 激坂
}

export function renderElevationProfile(svg, path, elevations, progress) {
  if (!svg || !elevations || elevations.length < 2) return;
  const w = 100;
  const h = 100;
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const span = Math.max(1, max - min);
  const segCount = elevations.length - 1;
  const segDistanceM = path.totalDistanceM > 0 ? path.totalDistanceM / segCount : 0;

  const points = elevations.map((e, i) => ({
    x: (i / segCount) * w,
    y: h - ((e - min) / span) * h * 0.85 - h * 0.08,
  }));

  const pointsAttr = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const cursorX = (progress * w).toFixed(2);

  // 勾配で色分けした短い線分をつなげて描く（単色ポリラインだと坂の場所が
  // 分からないため、登り/下りが一目で分かるように区間ごとに色を変える）
  let segments = '';
  for (let i = 0; i < points.length - 1; i++) {
    const grade = segDistanceM > 0 ? ((elevations[i + 1] - elevations[i]) / segDistanceM) * 100 : 0;
    segments += `<line x1="${points[i].x.toFixed(2)}" y1="${points[i].y.toFixed(2)}" x2="${points[i + 1].x.toFixed(2)}" y2="${points[i + 1].y.toFixed(2)}" stroke="${gradeColor(grade)}" stroke-width="1.6" stroke-linecap="round" vector-effect="non-scaling-stroke" />`;
  }

  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = `
    <polygon points="0,${h} ${pointsAttr} ${w},${h}" fill="rgba(148,163,184,0.14)" />
    ${segments}
    <line x1="${cursorX}" y1="0" x2="${cursorX}" y2="${h}" stroke="#f97316"
          stroke-width="1.5" vector-effect="non-scaling-stroke" />
  `;
}
