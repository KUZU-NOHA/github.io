import { isLicenseActive } from './licenses.js';

/**
 * リクエストヘッダーからライセンスキーを取り出し、有効性を確認する。
 * 無効なら 403 を返した上で呼び出し側に false を伝える
 * （呼び出し側は `if (!(await requireLicense(req, res))) return;` の形で使う）。
 */
export async function requireLicense(req, res) {
  const licenseKey = req.headers['x-vcycling-license-key'];
  if (!licenseKey) {
    res.status(401).json({ error: 'license key is required' });
    return false;
  }
  const active = await isLicenseActive(licenseKey);
  if (!active) {
    res.status(403).json({ error: 'subscription not active' });
    return false;
  }
  return true;
}
