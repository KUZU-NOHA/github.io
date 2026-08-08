/**
 * 2D フォールバック表示
 *
 * 以下のケースで 3D の代わりに使う：
 *   - API キーが未設定（初回起動・動作確認時）
 *   - 3D タイル非対応地域（要件定義書 R-06）
 *   - Map3DElement の初期化に失敗した場合
 *
 * API キーがあれば、コースに沿った実際の地図（Static Maps API）を背景に
 * 敷く。3D 映像が使えない環境でも「風景」の手がかりが見えるようにする
 * ための改善で、ルート選択のたびに1回だけ画像を取得し、走行中に
 * 再取得はしない（低コスト）。
 *
 * API キーが無くても、外部依存を持たない Canvas 描画だけで動く。
 * これにより「キーが無いと何も試せない」状態を避けている。
 */

import { getApiKey } from '../config.js';

const STATIC_MAP_ENDPOINT = 'https://maps.googleapis.com/maps/api/staticmap';
const TILE_SIZE = 256;
const MAX_ZOOM = 20;

/**
 * 緯度経度を Web Mercator の「ワールド座標」に変換する。
 * ズーム0のときの 256×256 タイル1枚を単位とする、Google Maps 標準の投影。
 * Static Maps API の描画結果と正確に一致させるためにこの投影を使う。
 */
export function latLngToWorldPoint(lat, lng) {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: TILE_SIZE * (0.5 + lng / 360),
    y: TILE_SIZE * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
  };
}

/**
 * 範囲(bounds)がぴったり収まる最大のズームレベルを求める。
 * Static Maps API に渡す zoom と、Canvas 側の投影の両方で使うことで、
 * 背景画像と前景（ルート線・現在地マーカー）を正確に一致させる。
 */
export function zoomForBounds(bounds, widthPx, heightPx, maxZoom = MAX_ZOOM) {
  const p1 = latLngToWorldPoint(bounds.maxLat, bounds.minLng);
  const p2 = latLngToWorldPoint(bounds.minLat, bounds.maxLng);
  const dx = Math.max(1e-6, Math.abs(p2.x - p1.x));
  const dy = Math.max(1e-6, Math.abs(p2.y - p1.y));
  const zoomX = Math.log2(widthPx / dx);
  const zoomY = Math.log2(heightPx / dy);
  return Math.max(0, Math.min(maxZoom, Math.floor(Math.min(zoomX, zoomY))));
}

export class Fallback2D {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fallback-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.path = null;
    this.available = true;
    this._onResize = () => {
      this._resize();
      if (!this.path) return;
      // 背景画像を取得済みなら zoom/center は画像取得時の値のまま据え置く
      // （_project() 内の拡大率補正だけで追従させる。ここで再計算すると
      // 画像の地理的範囲の解釈とオーバーレイの投影がズレてしまう）。
      // 画像がまだ無ければ、見た目のズームをそのつど再計算してよい
      if (!this._bgImage) this._computeProjection();
      if (this._lastSnapshot) this.update(this._lastSnapshot);
    };
    this._bgImage = null;
    this._lastSnapshot = null;
  }

  async init(path) {
    this.path = path;
    this.container.innerHTML = '';
    this.container.appendChild(this.canvas);
    this._resize();
    window.addEventListener('resize', this._onResize);
    this._computeBounds();
    this._computeProjection();
    this.update({
      position: path.points[0],
      heading: 0,
      progress: 0,
      distanceM: 0,
      grade: 0,
    });

    // 失敗しても図形描画だけの表示にフォールバックする（await しない）
    this._loadBackground().catch(() => {});

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
    const padLat = Math.max((maxLat - minLat) * 0.15, 0.0008);
    const padLng = Math.max((maxLng - minLng) * 0.15, 0.0008);
    this.bounds = {
      minLat: minLat - padLat, maxLat: maxLat + padLat,
      minLng: minLng - padLng, maxLng: maxLng + padLng,
    };
  }

  /**
   * Web Mercator ベースの投影パラメータ（中心・ズーム）を決める。
   * Static Maps API に渡す center/zoom と全く同じ値を使うことで、
   * 背景画像とオーバーレイのズレを無くしている。
   */
  _computeProjection() {
    const { minLat, maxLat, minLng, maxLng } = this.bounds;
    this._center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
    this._zoom = zoomForBounds(this.bounds, this._w, this._h);
    this._scale = TILE_SIZE * 2 ** this._zoom;
    this._centerWorld = latLngToWorldPoint(this._center.lat, this._center.lng);
  }

  _project(p) {
    const world = latLngToWorldPoint(p.lat, p.lng);
    let dx = (world.x - this._centerWorld.x) * (this._scale / TILE_SIZE);
    let dy = (world.y - this._centerWorld.y) * (this._scale / TILE_SIZE);

    // 背景画像は Static Maps API の取得サイズ（最大640px）から Canvas の
    // 実表示サイズへ拡大して描画される。取得時と表示時でアスペクト比は
    // 揃えてあるが、ピクセル数そのものは違うため、オーバーレイの座標も
    // 同じ拡大率でスケールしないと背景とズレる
    if (this._bgImageFetchSize) {
      dx *= this._w / this._bgImageFetchSize.w;
      dy *= this._h / this._bgImageFetchSize.h;
    }

    return { x: this._w / 2 + dx, y: this._h / 2 + dy };
  }

  /**
   * コースに沿った実際の地図画像を取得する。
   * center/zoom を明示指定することで、Canvas 側の投影と正確に一致させる
   * （path 引数による自動フィットだと、余白の取り方が非公開で位置がずれる）。
   */
  async _loadBackground() {
    const key = getApiKey();
    if (!key || !this._w || !this._h) return;

    const maxDim = 640;
    const aspect = this._w / this._h;
    const sizeW = Math.round(aspect >= 1 ? maxDim : maxDim * aspect);
    const sizeH = Math.round(aspect >= 1 ? maxDim / aspect : maxDim);

    // 取得サイズと Canvas 表示サイズが違うと投影がずれるため、
    // 実際に使う zoom はこの取得サイズで再計算する
    const zoom = zoomForBounds(this.bounds, sizeW, sizeH);

    const params = new URLSearchParams({
      size: `${sizeW}x${sizeH}`,
      scale: '2',
      maptype: 'roadmap',
      center: `${this._center.lat},${this._center.lng}`,
      zoom: String(zoom),
      key,
    });

    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('背景地図の取得に失敗しました'));
      img.src = `${STATIC_MAP_ENDPOINT}?${params}`;
    });

    // 実際に取得できた zoom とサイズで Canvas 側の投影も合わせ直す
    this._zoom = zoom;
    this._scale = TILE_SIZE * 2 ** zoom;
    this._bgImageFetchSize = { w: sizeW, h: sizeH };
    this._bgImage = img;
    if (this._lastSnapshot) this.update(this._lastSnapshot);
  }

  update(snapshot) {
    if (!this.path || !this._w) return;
    this._lastSnapshot = snapshot;
    const ctx = this.ctx;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;

    if (this._bgImage) {
      // 背景地図を敷いたうえで軽く暗幕をかけ、上に重ねる
      // ルート線・現在地マーカーを常に読みやすくする
      ctx.drawImage(this._bgImage, 0, 0, this._w, this._h);
      ctx.fillStyle = dark ? 'rgba(6, 12, 24, 0.45)' : 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(0, 0, this._w, this._h);
    } else {
      ctx.fillStyle = dark ? '#0b1220' : '#eef2f7';
      ctx.fillRect(0, 0, this._w, this._h);
    }

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

    ctx.fillStyle = dark ? '#cbd5e1' : '#334155';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(
      this._bgImage
        ? '2D 表示モード（実際の地図を表示中）'
        : '2D 表示モード（3D映像には API キーが必要です）',
      14,
      this._h - 14
    );
  }

  setCamera() { /* 2D では視点設定は無効 */ }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.available = false;
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}
