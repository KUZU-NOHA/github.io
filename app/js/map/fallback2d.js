/**
 * 2D フォールバック表示
 *
 * 以下のケースで 3D の代わりに使う：
 *   - API キーが未設定（初回起動・動作確認時）
 *   - 3D タイル非対応地域（要件定義書 R-06）
 *   - Map3DElement の初期化に失敗した場合
 *
 * 外部依存を持たない Canvas 描画なので、ネットワークが無くても動く。
 * これにより「キーが無いと何も試せない」状態を避けている。
 */

export class Fallback2D {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fallback-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.path = null;
    this.available = true;
    this._onResize = () => this._resize();
  }

  async init(path) {
    this.path = path;
    this.container.innerHTML = '';
    this.container.appendChild(this.canvas);
    this._resize();
    window.addEventListener('resize', this._onResize);
    this._computeBounds();
    this.update({
      position: path.points[0],
      heading: 0,
      progress: 0,
      distanceM: 0,
      grade: 0,
    });
    return this;
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
  }

  _computeBounds() {
    const pts = this.path.points;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of pts) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
    }
    // 経路が一直線でも潰れないよう最小幅を確保する
    const padLat = Math.max((maxLat - minLat) * 0.12, 0.0008);
    const padLng = Math.max((maxLng - minLng) * 0.12, 0.0008);
    this.bounds = {
      minLat: minLat - padLat, maxLat: maxLat + padLat,
      minLng: minLng - padLng, maxLng: maxLng + padLng,
    };
  }

  _project(p) {
    const { minLat, maxLat, minLng, maxLng } = this.bounds;
    // 緯度による経度の縮尺差を補正
    const latScale = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const spanLng = (maxLng - minLng) * latScale;
    const spanLat = maxLat - minLat;
    const scale = Math.min(this._w / spanLng, this._h / spanLat) * 0.88;
    const cx = this._w / 2;
    const cy = this._h / 2;
    return {
      x: cx + (((p.lng - minLng) - spanLng / latScale / 2) * latScale) * scale,
      y: cy - ((p.lat - minLat) - spanLat / 2) * scale,
    };
  }

  update(snapshot) {
    if (!this.path || !this._w) return;
    const ctx = this.ctx;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;

    ctx.fillStyle = dark ? '#0b1220' : '#eef2f7';
    ctx.fillRect(0, 0, this._w, this._h);

    // ルート全体
    ctx.beginPath();
    this.path.points.forEach((p, i) => {
      const { x, y } = this._project(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = dark ? '#334155' : '#cbd5e1';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 走破済み区間
    const traveled = Math.max(0, Math.min(1, snapshot.progress ?? 0));
    const cutoff = traveled * (this.path.points.length - 1);
    ctx.beginPath();
    for (let i = 0; i <= Math.floor(cutoff); i++) {
      const { x, y } = this._project(this.path.points[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 6;
    ctx.stroke();

    // 現在地
    const pos = this._project(snapshot.position);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = dark ? '#0b1220' : '#ffffff';
    ctx.stroke();

    // 進行方向
    const rad = ((snapshot.heading ?? 0) - 90) * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x + Math.cos(rad) * 26, pos.y + Math.sin(rad) * 26);
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = dark ? '#94a3b8' : '#475569';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('2D 表示モード（3D映像には API キーが必要です）', 14, this._h - 14);
  }

  setCamera() { /* 2D では視点設定は無効 */ }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.available = false;
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}
