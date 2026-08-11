/**
 * 設定・API キー・サブスクリプションの管理
 *
 * ⚠️ セキュリティ方針（要件定義書 7.3）
 * 静的サイトである以上、API キーはクライアントに露出する。これは回避できない。
 * したがってキーをリポジトリにコミットせず、利用者が自分のブラウザに保存する方式を取る。
 * 併せて Google Cloud 側で以下を設定することを必須とする：
 *   - HTTP リファラ制限
 *   - API 種別制限
 *   - 日次クォータ上限
 *   - 予算アラート
 *
 * ⚠️ サブスクリプション方針（要件定義書 7.5）
 * 「自分の API キーを貼る」（BYOK）は無料のまま無期限で維持する。
 * サブスクはこれとは別の経路で、ライセンスキーをバックエンド（server/）に
 * 照会し、有効なら Maps 連携機能を使わせる。実際の Google API キーは
 * バックエンドの環境変数にしか存在せず、クライアントに渡るのは
 * 「Maps JavaScript API のローダー用キー」だけ（要件定義書 7.5 の系統B）。
 * バックエンドが落ちている・未デプロイの場合は BYOK に自動フォールバックする。
 */

const KEY_STORAGE = 'vcycling.apiKey';
const SETTINGS_STORAGE = 'vcycling.settings';
const LICENSE_KEY_STORAGE = 'vcycling.licenseKey';
const LICENSE_EMAIL_STORAGE = 'vcycling.licenseEmail';

// Phase B でバックエンド（server/）を実デプロイしたら、実際のURLに差し替える
export const BACKEND_BASE_URL = 'https://vcycling-backend.vercel.app';

// Stripeサンドボックス（テストモード）のPayment Link。動作確認用の仮価格（月額500円）で
// 作成済み（after_completionのredirectは https://kuzu-noha.github.io/github.io/app/
// ?checkout_session_id={CHECKOUT_SESSION_ID} に設定済み）。本番移行時は本番アカウントで
// 正式な価格のPayment Linkを作り直し、このURLを差し替えること
export const SUBSCRIBE_URL = 'https://buy.stripe.com/test_aFa5kD7M0cyY5n7ga45J600';

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

export function getLicenseKey() {
  try {
    return localStorage.getItem(LICENSE_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setLicenseKey(key) {
  try {
    if (key) localStorage.setItem(LICENSE_KEY_STORAGE, key.trim());
    else localStorage.removeItem(LICENSE_KEY_STORAGE);
  } catch {
    /* プライベートモード等で保存できない場合は無視 */
  }
}

export function hasLicenseKey() {
  return getLicenseKey().length > 0;
}

export function getLicenseEmail() {
  try {
    return localStorage.getItem(LICENSE_EMAIL_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setLicenseEmail(email) {
  try {
    if (email) localStorage.setItem(LICENSE_EMAIL_STORAGE, email.trim());
    else localStorage.removeItem(LICENSE_EMAIL_STORAGE);
  } catch {
    /* 無視 */
  }
}

/**
 * バックエンド（server/、系統A・系統Bとも共通）へライセンス情報を伝える
 * ヘッダー。ライセンスキー未設定なら空オブジェクトを返すので、呼び出し側は
 * 「BYOKで直接呼ぶか／このヘッダーを付けてバックエンド経由で呼ぶか」を
 * hasLicenseKey() で分岐すればよい。
 */
export function backendAuthHeaders() {
  const licenseKey = getLicenseKey();
  if (!licenseKey) return {};
  return {
    'X-Vcycling-License-Key': licenseKey,
    'X-Vcycling-License-Email': getLicenseEmail(),
  };
}

/**
 * Stripe Checkout 完了後のリダイレクトで受け取った session_id を、
 * バックエンド（/api/subscribe/complete）でライセンスキーに交換する。
 * 成功すればライセンスキー・メールを保存して true を返す
 * （呼び出し側は main.js の bindLicenseSetup 参照）。
 */
export async function completeCheckout(sessionId) {
  const res = await fetch(
    `${BACKEND_BASE_URL}/api/subscribe/complete?session_id=${encodeURIComponent(sessionId)}`
  );
  if (!res.ok) return false;
  const json = await res.json();
  if (!json.licenseKey) return false;
  setLicenseKey(json.licenseKey);
  setLicenseEmail(json.email || '');
  return true;
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
 * 3D映像用の Maps JavaScript API キーを解決する。
 *
 * ライセンスキー（サブスク）があれば、まずバックエンドの系統Bエンドポイント
 * （/api/maps/key）に照会する。バックエンドは Stripe にサブスクリプションの
 * 有効性を確認したうえで、リファラ制限付きの「ローダー用キー」を返す
 * （実際に日次クォータで守られたキー本体はサーバー側にしか置かれない）。
 * ライセンスキーが無い、またはバックエンドが未デプロイ・不通・無効判定の
 * 場合は、これまでどおり自分の API キー（BYOK）にフォールバックする。
 */
async function resolveMapsApiKey() {
  const licenseKey = getLicenseKey();
  if (licenseKey) {
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/api/maps/key`, {
        method: 'POST',
        headers: backendAuthHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.key) return json.key;
      }
    } catch {
      /* バックエンド不通時は BYOK にフォールバックする（下へ続く） */
    }
  }

  const byok = getApiKey();
  if (byok) return byok;
  throw new Error('API キーが未設定です');
}

/**
 * Maps JavaScript API を動的に読み込む。
 * 3D Maps を使うため v=alpha 系のチャンネルを指定する。
 */
let mapsLoader = null;
export function loadGoogleMaps() {
  if (mapsLoader) return mapsLoader;

  mapsLoader = resolveMapsApiKey()
    .then(
      (key) =>
        new Promise((resolve, reject) => {
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
        })
    )
    .catch((err) => {
      // 失敗時はキャッシュを残さない。BYOK⇄サブスクを切り替えて
      // 再試行した際に、古い失敗が固定されてしまわないようにするため
      mapsLoader = null;
      throw err;
    });

  return mapsLoader;
}

/** キーを変更した場合、ページを再読込しないと Maps は差し替わらない */
export function resetMapsLoader() {
  mapsLoader = null;
}
