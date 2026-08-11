/**
 * Lemon Squeezy のライセンス API への照会（要件定義書 7.5）。
 * 系統A（Routes/Elevation/Static Maps の代理取得）・系統B
 * （Maps JavaScript API ローダー用キーの配布）の両方が、
 * リクエストを処理する前にここでライセンスキーの有効性を確認する。
 *
 * ⚠️ Phase B での確認事項: エンドポイント・リクエスト/レスポンス形状は
 * 実装時点の Lemon Squeezy License API の想定に基づく。デプロイ前に
 * 最新の公式ドキュメント（https://docs.lemonsqueezy.com/help/licensing）
 * と突き合わせて確認すること。
 */

const LEMONSQUEEZY_VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate';

// サブスクが有効かどうかの判定を短時間キャッシュする。
// サーバーレス関数のインスタンスは短時間なら使い回されることがあるため、
// 同一インスタンス内であれば Lemon Squeezy への往復を間引ける
// （インスタンスが使い捨てられれば単に効かないだけで、正しさには影響しない）。
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分
const cache = new Map(); // licenseKey -> { at: number, valid: boolean }

/**
 * ライセンスキーが現在有効かどうかを返す。
 *
 * @param {string} licenseKey
 * @param {{ fetchImpl?: typeof fetch, now?: number }} [opts] テスト時に fetch と時刻を差し替えるためのフック
 */
export async function isLicenseActive(licenseKey, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now();

  if (!licenseKey) return false;

  const cached = cache.get(licenseKey);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.valid;

  const valid = await queryLemonSqueezy(licenseKey, fetchImpl);
  cache.set(licenseKey, { at: now, valid });
  return valid;
}

async function queryLemonSqueezy(licenseKey, fetchImpl) {
  try {
    const res = await fetchImpl(LEMONSQUEEZY_VALIDATE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ license_key: licenseKey }).toString(),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return !!json.valid && json.license_key?.status === 'active';
  } catch {
    return false;
  }
}

/** テスト・デバッグ用。本番コードからは呼ばない */
export function clearLicenseCache() {
  cache.clear();
}
