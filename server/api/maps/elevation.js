import { requireLicense } from '../../lib/requireLicense.js';
import { withCors } from '../../lib/cors.js';

const ELEVATION_ENDPOINT = 'https://maps.googleapis.com/maps/api/elevation/json';

/**
 * 系統A: Elevation API の代理取得（要件定義書 7.5）。
 * 実キーはこの関数の中にしかない。クライアントには渡さない。
 */
export default async function handler(req, res) {
  withCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  if (!(await requireLicense(req, res))) return;

  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return res.status(500).json({ error: 'server misconfigured' });

  const locations = req.query.locations;
  if (!locations) return res.status(400).json({ error: 'locations is required' });

  const upstream = await fetch(
    `${ELEVATION_ENDPOINT}?locations=${encodeURIComponent(locations)}&key=${key}`
  );
  const body = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', 'application/json');
  return res.send(body);
}
