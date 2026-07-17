/**
 * Extract a one-time / verification code from email text. Purely language-based —
 * it keys off generic verification vocabulary ("code", "verification", "OTP", …)
 * and never off any sender, brand, or vendor string, so it works for any site.
 */

const KEYWORDS =
  "verification|verify|security|one[- ]?time|confirmation|confirm|access|login|log[- ]?in|sign[- ]?in|authenticat(?:e|ion)|otp|passcode|pass ?code|pin|code";

// A digit run (5–8) that appears right after a verification keyword:
//   "your verification code is 123456", "security code: 048192"
//   (minimum 5 digits to avoid false positives on years like "2026")
const CODE_AFTER_KEYWORD = new RegExp(`(?:${KEYWORDS})[^0-9]{0,40}([0-9]{5,8})`, "i");

// A digit run right before the keyword: "123456 is your verification code"
const CODE_BEFORE_KEYWORD = new RegExp(
  `\\b([0-9]{5,8})\\b[^0-9]{0,30}(?:is your|${KEYWORDS})`,
  "i",
);

// Alphanumeric codes near a keyword: "code: kOgYB2QM", "enter A1b2C3".
// Uses a lazy match across up to 80 chars (the old [^A-Za-z0-9]{0,20} was
// too narrow — Greenhouse emails often have full sentences between the
// keyword and the code, e.g. "security code field on your application: XXXX").
const ALNUM_NEAR_KEYWORD = new RegExp(`(?:${KEYWORDS})[\\s\\S]{0,80}?\\b([A-Za-z0-9]{5,10})\\b`, "i");

// Greenhouse plain-text pattern: "Copy and paste this code into the security
// code field on your application: kOgYB2QM" — code follows "application:"
// or "field:" after the keyword.
const GREENHOUSE_CODE = /(?:application|field)\s*:\s*([A-Za-z0-9]{5,10})\b/i;

// Greenhouse: code on the next line/block after the application prompt (no colon).
const GREENHOUSE_AFTER_PROMPT =
	/(?:paste this code|security code field|your application)[\s\S]{0,240}?\b([A-Za-z0-9]{6,10})\b/i;

// Greenhouse standard 8-char OTP block after the copy/paste instruction.
const GREENHOUSE_EIGHT_CHAR =
	/(?:paste this code into the security code field|Copy and paste this code)[\s\S]{0,400}?\b([A-Za-z0-9]{8})\b/i;

// Greenhouse-style: codes split across single-char inputs, often rendered in
// HTML as spaced digits: "1 2 3 4 5 6" or "1-2-3-4-5-6" or "1&nbsp;2&nbsp;3..."
const SPACED_CODE = /\b([0-9])[\s\-–—&nbsp;]{1,3}([0-9])[\s\-–—&nbsp;]{1,3}([0-9])[\s\-–—&nbsp;]{1,3}([0-9])[\s\-–—&nbsp;]{1,3}([0-9])[\s\-–—&nbsp;]{1,3}([0-9])(?:[\s\-–—&nbsp;]{1,3}([0-9])[\s\-–—&nbsp;]{1,3}([0-9]))?\b/;

// Digit runs that appear in <div>/<td>/<span> tags (common in Greenhouse HTML emails
// where each digit gets its own styled box). We collapse and re-scan the plain-text.
// This is handled by stripping HTML and running the above patterns on bodyText.

/**
 * Convert HTML to plain text for code extraction. Strips tags and normalizes
 * whitespace so that codes rendered in <td>/<div> grids become scannable.
 */
function htmlToPlainText(html) {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?p[^>]*>/gi, "\n")
    .replace(/<\/?div[^>]*>/gi, "\n")
    .replace(/<\/?td[^>]*>/gi, " ")
    .replace(/<\/?tr[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#?[a-z0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract Greenhouse's 8-character application security code (preferred for OTP auto-fill).
 * @param {string} text
 * @returns {string|null}
 */
export function extractGreenhouseOtpCode(text) {
  const t = String(text || "");
  if (!t) return null;

  let m = t.match(GREENHOUSE_EIGHT_CHAR);
  if (m && /[0-9]/.test(m[1]) && /[A-Za-z]/.test(m[1])) return m[1];

  m = t.match(GREENHOUSE_AFTER_PROMPT);
  if (m && m[1].length === 8 && /[0-9]/.test(m[1]) && /[A-Za-z]/.test(m[1])) return m[1];

  if (/<[^>]+>/.test(t)) {
    const plain = htmlToPlainText(t);
    if (plain && plain !== t) return extractGreenhouseOtpCode(plain);
  }

  return null;
}

/**
 * @param {string} text
 * @returns {string|null} the code, or null if none found.
 */
export function extractVerificationCode(text) {
  const t = String(text || "");
  if (!t) return null;

  let m;

  m = t.match(GREENHOUSE_EIGHT_CHAR);
  if (m && /[0-9]/.test(m[1]) && /[A-Za-z]/.test(m[1])) return m[1];

  // 1. Most specific first: Greenhouse plain-text "application: kOgYB2QM"
  m = t.match(GREENHOUSE_CODE);
  if (m && /[0-9A-Za-z]/.test(m[1])) return m[1];

  m = t.match(GREENHOUSE_AFTER_PROMPT);
  if (m && /[0-9]/.test(m[1]) && /[A-Za-z]/.test(m[1])) return m[1];

  // 2. Alphanumeric codes near a keyword: "code: A1b2C3d4"
  //    (contains letters, so less likely to be a false positive)
  m = t.match(ALNUM_NEAR_KEYWORD);
  if (m && /[0-9]/.test(m[1])) return m[1];

  // 3. Pure digit codes after keyword (5-8 digits to avoid years)
  m = t.match(CODE_AFTER_KEYWORD);
  if (m) return m[1];

  // 4. Pure digit codes before keyword
  m = t.match(CODE_BEFORE_KEYWORD);
  if (m) return m[1];

  // 5. Spaced/split digit codes (Greenhouse-style single-char inputs)
  m = t.match(SPACED_CODE);
  if (m) {
    const digits = m.slice(1).filter(Boolean).join("");
    if (digits.length >= 4 && digits.length <= 8) return digits;
  }

  // 6. Try on plain-text version (strip HTML if present)
  if (/<[^>]+>/.test(t)) {
    const plain = htmlToPlainText(t);
    if (plain && plain !== t) {
      return extractVerificationCode(plain);
    }
  }

  return null;
}
