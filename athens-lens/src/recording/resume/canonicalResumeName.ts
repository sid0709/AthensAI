/**
 * Recruiter-facing ATS upload name helpers — keep in sync with
 * Athens-server/src/lib/canonicalResumeName.js and Bid-Monitor.
 */

const WIN_RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export function sanitizeResumeSegment(value: unknown): string {
  let s = String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!s) s = "Unknown";
  if (WIN_RESERVED.has(s.toUpperCase())) s = `_${s}`;
  return s;
}

/** Recruiter-facing ATS upload name: `Profile Name.ext`. */
export function buildProfileResumeFileName(profileName: string, ext = ".pdf"): string {
  const profileSeg = sanitizeResumeSegment(profileName);
  const safeExt = String(ext || ".pdf").startsWith(".") ? String(ext) : `.${ext}`;
  return `${profileSeg}${safeExt}`;
}

export function resumeBasename(name: unknown): string {
  const s = String(name || "").trim();
  if (!s) return "";
  const parts = s.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "";
}

/** Spaces stripped profile folder fallback (Bid-Monitor resumeSetFolder style). */
export function profileNameToFileBase(profileName: string | null | undefined): string | null {
  if (!profileName) return null;
  const base = String(profileName).replace(/\s+/g, "").trim();
  return base.length > 0 ? base : null;
}
