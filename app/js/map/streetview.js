/**
 * ストリートビューのスポット表示
 *
 * ⚠️ コスト設計（要件定義書 2.2 / 2.3）
 * Dynamic Street View はパノラマ1枚ごとに課金される（$14/1000）。
 * 常時表示すると30分のライドで $14 相当に達しうるため、
 *   - ユーザーが「見回す」を押したとき
 *   - 1km ごとのチェックポイント
 * のみに限定する。これで1ライドあたり10〜20回程度に収まり、
 * 月5,000回の無料枠に十分収まる。
 *
 * ⚠️ 規約（要件定義書 L-03）
 * ストリートビュー画像と非Googleマップの同一画面表示は禁止されている。
 * ミニマップには必ず Google Maps を使うこと。
 */

export class StreetViewSpot {
  constructor(container) {
    this.container = container;
    this.panorama = null;
    this.service = null;
    this.visible = false;
    this.loadCount = 0;
  }

  async init() {
    const { StreetViewPanorama, StreetViewService, StreetViewStatus } =
      await google.maps.importLibrary('streetView');
    this._StreetViewStatus = StreetViewStatus;
    this.service = new StreetViewService();
    this.panorama = new StreetViewPanorama(this.container, {
      visible: false,
      addressControl: false,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
      linksControl: false,
      panControl: true,
      zoomControl: true,
      enableCloseButton: false,
    });
    return this;
  }

  /**
   * 指定地点のパノラマを表示する。
   * 近くにパノラマが無ければ false を返す（課金は発生しない）。
   *
   * @param {{lat:number,lng:number}} position
   * @param {number} heading 進行方向を向かせる
   * @param {number} radiusM 探索半径
   */
  async show(position, heading = 0, radiusM = 60) {
    if (!this.panorama || !this.service) return false;

    try {
      const { data } = await this.service.getPanorama({
        location: position,
        radius: radiusM,
        source: 'outdoor',
      });
      if (!data?.location?.pano) return false;

      // setPano がパノラマ読込＝課金イベントになる
      this.panorama.setPano(data.location.pano);
      this.panorama.setPov({ heading, pitch: 0 });
      this.panorama.setVisible(true);
      this.visible = true;
      this.loadCount++;
      this.container.classList.add('is-visible');
      return true;
    } catch {
      // パノラマが存在しない地点では例外になる。無音で諦めてよい
      return false;
    }
  }

  hide() {
    if (!this.panorama) return;
    this.panorama.setVisible(false);
    this.visible = false;
    this.container.classList.remove('is-visible');
  }

  toggle(position, heading) {
    if (this.visible) {
      this.hide();
      return Promise.resolve(false);
    }
    return this.show(position, heading);
  }
}

/**
 * 一定距離ごとにチェックポイントを発火させるヘルパー。
 * 走行距離を渡すと、しきい値を跨いだタイミングで true を返す。
 */
export class CheckpointTracker {
  constructor(intervalM = 1000) {
    this.intervalM = intervalM;
    this.lastFiredAt = 0;
  }

  shouldFire(distanceM) {
    if (distanceM - this.lastFiredAt >= this.intervalM) {
      this.lastFiredAt = Math.floor(distanceM / this.intervalM) * this.intervalM;
      return true;
    }
    return false;
  }

  reset() {
    this.lastFiredAt = 0;
  }
}
