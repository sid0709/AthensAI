/**
 * Drop third-party challenge / captcha frames from Oak multi-frame merges.
 * Structural host filtering only — not ATS/vendor-specific form logic.
 */

const NOISE_HOST_RE =
  /(^|\.)((h)?captcha|recaptcha|funcaptcha|arkoselabs|challenges\.cloudflare|perimeterx|datadome|geetest)\./i;

const NOISE_PATH_RE = /\/(hcaptcha|recaptcha|captcha)(\/|\.html|#|\?|$)/i;

export function isNoiseFrameUrl(url: string | undefined | null): boolean {
  const raw = String(url || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (NOISE_HOST_RE.test(host)) return true;
    if (NOISE_PATH_RE.test(`${parsed.pathname}${parsed.hash}`)) return true;
    return false;
  } catch {
    return /hcaptcha|recaptcha|funcaptcha|arkoselabs/i.test(raw);
  }
}
