import Stripe from 'stripe';
import { randomBytes } from 'node:crypto';
import { withCors } from '../../lib/cors.js';
import { hashToken } from '../../lib/licenses.js';

/**
 * Stripe Checkout 完了後、アプリ側のライセンスキーを発行する（要件定義書 7.5）。
 *
 * Stripe Payment Link の「支払い後のリダイレクト先」に
 * `.../app/?checkout_session_id={CHECKOUT_SESSION_ID}` を設定しておくと、
 * アプリがこのエンドポイントへ session_id を渡して呼び出し、発行された
 * ライセンスキーを自動保存する（app/js/main.js の bindLicenseSetup 参照）。
 *
 * 呼ばれるたびに新しいトークンを発行し直す（Customer には直近のハッシュしか
 * 残らない）。決済直後の一度きりの受け渡しを想定した設計であり、同じ
 * session_id で複数回呼ばれても最後に発行されたキーだけが有効になる。
 */
export default async function handler(req, res) {
  withCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'server misconfigured' });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id is required' });

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['customer'] });
  } catch {
    return res.status(400).json({ error: 'invalid session_id' });
  }

  if (session.status !== 'complete' || session.payment_status === 'unpaid') {
    return res.status(402).json({ error: 'checkout not completed' });
  }

  const customer = session.customer;
  if (!customer || typeof customer === 'string' || customer.deleted) {
    return res.status(500).json({ error: 'customer not resolved' });
  }

  const token = randomBytes(32).toString('hex');
  await stripe.customers.update(customer.id, {
    metadata: { vcycling_key_hash: hashToken(token) },
  });

  return res.status(200).json({
    licenseKey: `vc_${customer.id}_${token}`,
    email: customer.email || session.customer_details?.email || '',
  });
}
