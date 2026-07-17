/**
 * Canonical résumé naming — keep in sync with Athens-server/src/lib/canonicalResumeName.js
 * Pattern: Company - Title - Profile - shortId
 */
const CanonicalResumeName = (() => {
  const WIN_RESERVED = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  ]);
  const MAX_STEM = 180;

  function sanitizeResumeSegment(value) {
    let s = String(value ?? '')
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\/\\:\*\?"<>\|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '');
    if (!s) s = 'Unknown';
    if (WIN_RESERVED.has(s.toUpperCase())) s = `_${s}`;
    return s;
  }

  function shortJobId(jobId) {
    const raw = String(jobId ?? '').trim();
    if (!raw) return 'unknown';
    const alnum = raw.replace(/[^a-zA-Z0-9]/g, '');
    if (!alnum) return 'unknown';
    return alnum.length <= 12 ? alnum : alnum.slice(-12);
  }

  function buildCanonicalResumeStem(company, title, profileName, jobId) {
    const companySeg = sanitizeResumeSegment(company);
    const profileSeg = sanitizeResumeSegment(profileName);
    const idSeg = shortJobId(jobId);
    const fixed = `${companySeg} -  - ${profileSeg} - ${idSeg}`;
    const budget = Math.max(8, MAX_STEM - fixed.length + 1);
    let titleSeg = sanitizeResumeSegment(title);
    if (titleSeg.length > budget) {
      titleSeg = titleSeg.slice(0, budget).replace(/[. ]+$/g, '') || 'Role';
    }
    let stem = `${companySeg} - ${titleSeg} - ${profileSeg} - ${idSeg}`;
    if (stem.length > MAX_STEM) {
      stem = stem.slice(0, MAX_STEM).replace(/[. ]+$/g, '');
    }
    return stem;
  }

  function buildCanonicalResumeFileName(company, title, profileName, jobId, ext = '.pdf') {
    const stem = buildCanonicalResumeStem(company, title, profileName, jobId);
    const safeExt = String(ext || '.pdf').startsWith('.') ? String(ext) : `.${ext}`;
    return `${stem}${safeExt}`;
  }

  function resumeBasename(name) {
    const s = String(name || '').trim();
    if (!s) return '';
    const parts = s.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || '';
  }

  function isResumeNameMismatch(originalName, expectedName) {
    const a = resumeBasename(originalName);
    const b = resumeBasename(expectedName);
    if (!a || !b) return false;
    return a !== b;
  }

  function profileNameToFileBase(applierName) {
    if (!applierName) return null;
    const base = String(applierName).replace(/\s+/g, '').trim();
    return base.length > 0 ? base : null;
  }

  return {
    sanitizeResumeSegment,
    shortJobId,
    buildCanonicalResumeStem,
    buildCanonicalResumeFileName,
    resumeBasename,
    isResumeNameMismatch,
    profileNameToFileBase,
  };
})();
