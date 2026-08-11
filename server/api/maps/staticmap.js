import { requireLicense } from '../../lib/requireLicense.js';
import { withCors } from '../../lib/cors.js';

const STATIC_MAP_ENDPOINT = 'https://maps.googleapis.com/maps/api/staticmap';

/**
 * 系統A: Static Maps API の代理取得（要件定義書 7.5）。
 * 画像バイト列をそのまま中継して返す。実キーはこの関数の中にしかない。
 */
export default async function handler(req, res) {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  if (!(await requireLicense(req, res))) return;

  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return res.status(500).json({ error: 'server misconfigured' });

  const params = new URLSearchParams(req.query);
  params.set('key', key);

  const upstream = await fetch(`${STATIC_MAP_ENDPOINT}?${params}`);
  if (!upstream.ok) return res.status(upstream.status).json({ error: 'upstream error' });

  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
  return res.status(200).send(buffer);
}
