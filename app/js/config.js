/**
 * 設定と API キーの管理
 *
 * ⚠️ セキュリティ方針（要件定義書 7.3）
 * 静的サイトである以上、API キーはクライアントに露出する。これは回避できない。
 * したがってキーをリポジトリにコミットせず、利用者が自分のブラウザに保存する方式を取る。
 * 併せて Google Cloud 側で以下を設定することを必須とする：
 *   - HTTP リファラ制限
 *   - API 種別制限
 *   - 日次クォータ上限
 *   - 予算アラート
 */

const KEY_STORAGE = 'vcycling.apiKey';
const SETTINGS_STORAGE = 'vcycling.settings';

export const DEFAULT_SETTINGS = {
  weightKg: 70,
  age: 40,
  targetWeightKg: 65,
  weeklyKcalGoal: 2000,
  speedMultiplier: 1,
  gradeEnabled: true,
  loop: true,
  cameraRangeM: 50,
  cameraTilt: 74,
  // CSC / Cycling Power のホイール回転数から速度を出す機種で使う。
  // 700x25C 相当。一体型エアロバイクでは通常この値は使われない
  wheelCircumferenceMm: 2105,
  // 速度の求め方。'auto' | 'power' | 'sensor'
  // 一体型エアロバイクのホイール回転数は内部カウントで実距離と対応しない
  // ことが多いため、既定ではパワーからの逆算を優先する
  speedSource: 'auto',
  // 車種。空気抵抗と転がり抵抗が変わり、同じ出力での到達速度に効く
  bikeProfile: 'road',
};

export function getApiKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* プライベートモード等で保存できない場合は無視 */
  }
}

export function hasApiKey() {
  return getApiKey().length > 0;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(settings));
  } catch {
    /* 保存できなくても走行自体は継続できる */
  }
}

/**
 * Maps JavaScript API を動的に読み込む。
 * 3D Maps を使うため v=alpha 系のチャンネルを指定する。
 */
let mapsLoader = null;
export function loadGoogleMaps() {
  if (mapsLoader) return mapsLoader;

  const key = getApiKey();
  if (!key) return Promise.reject(new Error('API キーが未設定です'));

  mapsLoader = new Promise((resolve, reject) => {
    if (window.google?.maps?.importLibrary) {
      resolve(window.google.maps);
      return;
    }
    const script = document.createElement('script');
    const params = new URLSearchParams({
      key,
      v: 'alpha',
      libraries: 'maps3d,maps,streetView,elevation,geometry',
      language: 'ja',
      region: 'JP',
      loading: 'async',
      callback: '__vcyclingMapsReady',
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    window.__vcyclingMapsReady = () => resolve(window.google.maps);
    script.onerror = () =>
      reject(
        new Error(
          'Google Maps の読み込みに失敗しました。API キーと、有効化した API（Maps JavaScript API / Map Tiles API）をご確認ください。'
        )
      );
    document.head.appendChild(script);
  });

  return mapsLoader;
}

/** キーを変更した場合、ページを再読込しないと Maps は差し替わらない */
export function resetMapsLoader() {
  mapsLoader = null;
}
