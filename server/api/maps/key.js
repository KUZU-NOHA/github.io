import { requireLicense } from '../../lib/requireLicense.js';
import { withCors } from '../../lib/cors.js';

/**
 * 系統B: Maps JavaScript API のローダー用キーを配布する（要件定義書 7.5）。
 *
 * ⚠️ このエンドポイントが返すキーは、返した時点でクライアントの
 * ブラウザから見える（開発者ツールの Network タブ等）。3D Tiles /
 * Street View は SDK 内部が直接 Google を叩くため、原理的にこれ以上は
 * 隠せない。ここでバックエンドが買っているのは「秘匿性」ではなく
 * 「認可」（未課金者には渡さない）と「即時失効」（漏洩時にこのキー自体を
 * Google Cloud 側でローテーションできる）。このキーには必ず HTTP
 * リファラ制限（kuzu-noha.github.io/github.io/*）を掛けること。
 */
export default async function handler(req, res) {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  if (!(await requireLicense(req, res))) return;

  const key = process.env.GOOGLE_MAPS_LOADER_KEY;
  if (!key) return res.status(500).json({ error: 'server misconfigured' });

  return res.status(200).json({ key });
}
