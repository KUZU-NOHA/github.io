import { requireLicense } from '../../lib/requireLicense.js';
import { withCors } from '../../lib/cors.js';

const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * 系統A: Routes API の代理取得（要件定義書 7.5）。
 * 実キーはこの関数の中にしかない。クライアントには渡さない。
 */
export default async function handler(req, res) {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  if (!(await requireLicense(req, res))) return;

  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return res.status(500).json({ error: 'server misconfigured' });

  const upstream = await fetch(ROUTES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration',
    },
    body: JSON.stringify(req.body),
  });

  const body = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', 'application/json');
  return res.send(body);
}
