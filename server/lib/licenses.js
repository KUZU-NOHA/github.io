/**
 * Stripe への照会でサブスクリプションの有効性を判定する（要件定義書 7.5）。
 *
 * ライセンスキーの形式: `vc_<Stripeカスタマーid>_<ランダムトークン(64桁hex)>`
 * トークン自体は保存せず、SHA-256ハッシュだけを Customer の metadata
 * （`vcycling_key_hash`）に保存して照合する（発行は api/subscribe/complete.js）。
 * 顧客IDを鍵に直接埋め込むことで、Stripe Search API（インデックス反映に
 * 遅延がある）を使わずに `customers.retrieve` で直接引ける。
 */
import Stripe from 'stripe';
import { createHash } from 'node:crypto';

// 実クライアントはimport時ではなく初回利用時に生成する
// （STRIPE_SECRET_KEY未設定時にモジュール読み込み自体が失敗するのを避けるため。
// テストではopts.stripeImplで完全に差し替えるのでここには到達しない）。
let defaultClient = null;
function getDefaultStripeClient() {
  if (defaultClient) return defaultClient;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  defaultClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  return defaultClient;
}

// サブスクが有効かどうかの判定を短時間キャッシュする。
// サーバーレス関数のインスタンスは短時間なら使い回されることがあるため、
// 同一インスタンス内であれば Stripe への往復を間引ける
// （インスタンスが使い捨てられれば単に効かないだけで、正しさには影響しない）。
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分
const cache = new Map(); // licenseKey -> { at: number, valid: boolean }

const LICENSE_KEY_PATTERN = /^vc_(cus_[a-zA-Z0-9]+)_([a-f0-9]{64})$/;

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function parseLicenseKey(licenseKey) {
  const match = LICENSE_KEY_PATTERN.exec(licenseKey);
  return match ? { customerId: match[1], token: match[2] } : null;
}

/**
 * ライセンスキーが現在有効かどうかを返す。
 *
 * @param {string} licenseKey
 * @param {{ stripeImpl?: Pick<Stripe, 'customers' | 'subscriptions'>, now?: number }} [opts] テスト時に Stripe クライアントと時刻を差し替えるためのフック
 */
export async function isLicenseActive(licenseKey, opts = {}) {
  const stripeImpl = opts.stripeImpl ?? getDefaultStripeClient();
  const now = opts.now ?? Date.now();

  if (!licenseKey || !stripeImpl) return false;

  const cached = cache.get(licenseKey);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.valid;

  const valid = await queryStripe(licenseKey, stripeImpl);
  cache.set(licenseKey, { at: now, valid });
  return valid;
}

async function queryStripe(licenseKey, stripeImpl) {
  const parsed = parseLicenseKey(licenseKey);
  if (!parsed) return false;

  try {
    const customer = await stripeImpl.customers.retrieve(parsed.customerId);
    if (!customer || customer.deleted) return false;

    const expectedHash = customer.metadata?.vcycling_key_hash;
    if (!expectedHash || hashToken(parsed.token) !== expectedHash) return false;

    const subs = await stripeImpl.subscriptions.list({
      customer: parsed.customerId,
      status: 'active',
      limit: 1,
    });
    return subs.data.length > 0;
  } catch {
    return false;
  }
}

/** テスト・デバッグ用。本番コードからは呼ばない */
export function clearLicenseCache() {
  cache.clear();
}
