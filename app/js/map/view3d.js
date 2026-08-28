/**
 * 3D 映像表示 — Maps JavaScript API の 3D Maps (Map3DElement)
 *
 * Photorealistic 3D Tiles をセッション課金で使うため、1回のライド中は
 * カメラを動かし続けても追加課金が発生しない（要件定義書 2.2）。
 *
 * カメラは「自分の少し後ろを追う三人称視点」に置く。地上目線に近づくほど
 * 3Dタイルの粗さが目立つため、あえて後方上空から見下ろす（要件定義書 2.4）。
 */

export class View3D {
  /**
   * @param {HTMLElement} container
   * @param {object} opts
   * @param {number} opts.rangeM カメラ距離[m]
   * @param {number} opts.tilt   カメラ俯角[度]
   */
  constructor(container, { rangeM = 50, tilt = 74 } = {}) {
    this.container = container;
    this.rangeM = rangeM;
    this.tilt = tilt;
    this.map = null;
    this.routeLine = null;
    this.available = false;
  }

  /**
   * 3D マップを初期化する。
   * 失敗した場合は例外を投げるので、呼び出し側で 2D フォールバックへ切り替える。
   */
  async init(path) {
    const { Map3DElement, MapMode, Polyline3DElement } =
      await google.maps.importLibrary('maps3d');

    const start = path.points[0];

    this.map = new Map3DElement({
      center: { lat: start.lat, lng: start.lng, altitude: 0 },
      range: this.rangeM,
      tilt: this.tilt,
      heading: 0,
      mode: MapMode.SATELLITE,
    });
    this.map.style.width = '100%';
    this.map.style.height = '100%';
    this.container.innerHTML = '';
    this.container.appendChild(this.map);

    // 走行ルートを地図上に描く
    try {
      this.routeLine = new Polyline3DElement({
        altitudeMode: 'CLAMP_TO_GROUND',
        strokeColor: 'rgba(56, 189, 248, 0.85)',
        strokeWidth: 8,
        coordinates: path.points.map((p) => ({ lat: p.lat, lng: p.lng })),
      });
      this.map.append(this.routeLine);
    } catch (err) {
      // ポリラインが描けなくても走行自体は成立するので続行する
      console.warn('ルート表示を初期化できませんでした:', err);
    }

    this.available = true;
    return this;
  }

  /**
   * 走行状態に合わせてカメラを更新する。毎フレーム呼ばれる。
   * @param {object} snapshot RideEngine.snapshot()
   */
  update(snapshot) {
    if (!this.available || !this.map) return;
    const { position, heading, altitude } = snapshot;
    this.map.center = {
      lat: position.lat,
      lng: position.lng,
      altitude: (altitude || 0) + 2,
    };
    this.map.heading = heading;
    this.map.range = this.rangeM;
    this.map.tilt = this.tilt;
  }

  setCamera({ rangeM, tilt }) {
    if (Number.isFinite(rangeM)) this.rangeM = rangeM;
    if (Number.isFinite(tilt)) this.tilt = tilt;
  }

  destroy() {
    this.available = false;
    if (this.map?.parentNode) this.map.parentNode.removeChild(this.map);
    this.map = null;
  }
}
