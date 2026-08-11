/**
 * CORS ヘッダーの付与。フロントエンド（GitHub Pages）と別オリジンの
 * Vercel デプロイになるため必須。
 *
 * ALLOWED_ORIGIN はカンマ区切りで複数指定できる（本番ドメインに加えて、
 * ローカル動作確認用の http://localhost:8000 などを併記する想定）。
 * リクエストの Origin がこの一覧に含まれていればそれをそのまま許可し、
 * 含まれていなければ一覧の先頭（本番ドメイン）を返す。
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'https://kuzu-noha.github.io')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function withCors(res, req) {
  const requestOrigin = req?.headers?.origin;
  const origin = requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Vcycling-License-Key, X-Vcycling-License-Email'
  );
  return res;
}
