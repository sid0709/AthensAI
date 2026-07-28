(function (root, factory) {
  const api = factory();
  root.BidResumeFileTracking = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function resumeBasename(name) {
    const value = String(name || '').trim();
    if (!value) return '';
    const parts = value.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || '';
  }

  function getExtension(fileName) {
    const base = resumeBasename(fileName);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot) : '';
  }

  function sanitizeForFileName(value) {
    return String(value || '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 60);
  }

  function buildSubmittedFileName(originalName, expectedResumeName, fallbackFolder) {
    const expected = resumeBasename(expectedResumeName);
    const originalExt = getExtension(originalName);
    const expectedExt = getExtension(expected);
    const ext = originalExt || expectedExt || '.pdf';

    if (expected) {
      const stem = expectedExt ? expected.slice(0, -expectedExt.length) : expected;
      return `${stem}${ext}`;
    }

    const safe = sanitizeForFileName(fallbackFolder);
    return safe ? `${safe}${ext}` : resumeBasename(originalName);
  }

  function buildRenameAudit({
    originalName,
    uploadedName,
    expectedName,
    sessionId,
    jobId,
    fileSize,
    lastModified,
    mimeType,
    pageUrl,
    pageTitle,
    source,
    company,
    title,
  }) {
    const original = resumeBasename(originalName);
    const uploaded = resumeBasename(uploadedName);
    const expected = resumeBasename(expectedName) || uploaded;
    return {
      sessionId: String(sessionId || '').trim() || null,
      jobId: String(jobId || '').trim() || null,
      originalFileName: original,
      originalName: original,
      submittedFileName: uploaded,
      cleanedName: uploaded,
      expectedName: expected || null,
      renamed: Boolean(original && uploaded && original !== uploaded),
      mismatch: Boolean(expected && uploaded && expected !== uploaded),
      fileName: original,
      fileSize: Number(fileSize) || 0,
      lastModified: Number(lastModified) || 0,
      mimeType: String(mimeType || '').trim() || null,
      pageUrl: String(pageUrl || '').trim() || null,
      pageTitle: String(pageTitle || '').trim() || null,
      source: String(source || '').trim() || null,
      company: String(company || '').trim() || null,
      title: String(title || '').trim() || null,
    };
  }

  const RESUME_AUDIT_OUTBOX_PREFIX = 'bidMonitorResumeAudit:';

  function resumeAuditOutboxKey(payload) {
    const seed = String(
      payload?.auditKey || [
        payload?.sessionId || '',
        payload?.jobId || '',
        resumeBasename(payload?.originalName || payload?.originalFileName),
        resumeBasename(payload?.cleanedName || payload?.submittedFileName),
        Number(payload?.fileSize) || 0,
        payload?.mimeType || '',
      ].join('|'),
    );
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const session = sanitizeForFileName(payload?.sessionId || 'session').slice(0, 40) || 'session';
    return `${RESUME_AUDIT_OUTBOX_PREFIX}${session}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function exactFileKey(file) {
    return [
      Number(file?.size) || 0,
      String(file?.type || ''),
      Number(file?.lastModified) || 0,
    ].join('|');
  }

  function contentFileKey(file) {
    return [Number(file?.size) || 0, String(file?.type || '')].join('|');
  }

  function createTracker() {
    let sessionKey = '';
    const originalByExactFile = new Map();
    const originalByContent = new Map();
    const emittedAuditKeys = new Set();

    function reset(nextSessionKey = '') {
      sessionKey = String(nextSessionKey || '');
      originalByExactFile.clear();
      originalByContent.clear();
      emittedAuditKeys.clear();
    }

    function rememberOriginal(file, originalName) {
      const original = resumeBasename(originalName);
      if (!original) return '';
      originalByExactFile.set(exactFileKey(file), original);
      originalByContent.set(contentFileKey(file), original);
      return original;
    }

    function resolveOriginal(file, expectedSubmittedName, stampedOriginalName) {
      const stamped = resumeBasename(stampedOriginalName);
      if (stamped) return rememberOriginal(file, stamped);

      const current = resumeBasename(file?.name);
      const expected = resumeBasename(expectedSubmittedName);
      if (expected && current === expected) {
        const remembered =
          originalByExactFile.get(exactFileKey(file)) ||
          originalByContent.get(contentFileKey(file));
        if (remembered) return remembered;
      }

      return rememberOriginal(file, current);
    }

    function buildAuditKey(payload) {
      return [
        sessionKey,
        resumeBasename(payload?.originalName),
        resumeBasename(payload?.cleanedName),
        Number(payload?.fileSize) || 0,
        String(payload?.mimeType || ''),
      ].join('|');
    }

    function shouldEmit(payload) {
      const key = buildAuditKey(payload);
      if (emittedAuditKeys.has(key)) return false;
      emittedAuditKeys.add(key);
      return true;
    }

    return { reset, resolveOriginal, buildAuditKey, shouldEmit };
  }

  return {
    resumeBasename,
    getExtension,
    buildSubmittedFileName,
    buildRenameAudit,
    RESUME_AUDIT_OUTBOX_PREFIX,
    resumeAuditOutboxKey,
    createTracker,
  };
});
