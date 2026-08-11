/**
 * CORS ヘッダーの付与。フロントエンド（GitHub Pages）と別オリジンの
 * Vercel デプロイになるため必須。
 */
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://kuzu-noha.github.io';

export function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Vcycling-License-Key, X-Vcycling-License-Email'
  );
  return res;
}
