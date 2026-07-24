/**
 * Athens Bid Ready API client for Bid-Monitor.
 * Loads the live vendor/tasks queue and uploads recordings.
 */
const AthensApi = (() => {
  const SETTINGS_KEY = 'athensSettings';
  /** From config.js (local .env / CI VPS_HOST via pack). Not user-configurable in the UI. */
  const DEFAULT_API_URL =
    (typeof BidMonitorConfig !== 'undefined' && BidMonitorConfig.ATHENS_API_URL) ||
    'http://127.0.0.1:8979/api';
  const QUEUE_TIMEOUT_MS = 15000;
  const UPLOAD_TIMEOUT_MS = 120000;
  const ANALYZE_TIMEOUT_MS = 300000;

  async function getSettings() {
    const { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    return {
      apiUrl: DEFAULT_API_URL,
      applierName: String(settings.applierName || '').trim(),
      email: String(settings.email || '').trim(),
    };
  }

  async function saveSettings(partial) {
    const current = await getSettings();
    const next = {
      apiUrl: DEFAULT_API_URL,
      applierName: String(partial.applierName ?? current.applierName).trim(),
      email: String(partial.email ?? current.email).trim(),
    };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }

  async function fetchJson(path, { method = 'GET', body, apiUrl: _apiUrl, timeoutMs } = {}) {
    const base = DEFAULT_API_URL;
    const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    const idToken = typeof AuthSession !== 'undefined' ? await AuthSession.getIdToken() : '';
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs ?? QUEUE_TIMEOUT_MS),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok || data?.success === false) {
      if (response.status === 413) {
        throw new Error(
          'Recording too large for the server (413). If you use host nginx/HTTPS, set client_max_body_size 4096m there too.',
        );
      }
      throw new Error(data?.error || `Athens request failed (${response.status})`);
    }
    return data;
  }

  function mapTaskToJob(task, applierName) {
    // Align with Athens: prefer reviewStatus over skipped.
    let status = 'pending';
    if (task.reviewStatus === 'rejected') status = 'rejected';
    else if (task.reviewStatus === 'submitted' || task.reviewStatus === 'reviewed') status = 'applied';
    else if (task.status === 'skipped' || task.progress === 'skipped') status = 'skipped';
    else if (task.progress === 'completed' || task.status === 'done') status = 'applied';
    else if (task.bidderInProcess) status = 'in_process';

    const jobId = task.jobId ? String(task.jobId) : String(task.id);
    const companyName = task.company || 'Unknown company';
    const title = task.title || 'Untitled role';
    const profileBase = applierName.replace(/\s+/g, '') || 'Resume';
    let expectedResumeName = null;
    try {
      if (typeof CanonicalResumeName !== 'undefined') {
        expectedResumeName = CanonicalResumeName.buildCanonicalResumeFileName(
          companyName,
          title,
          applierName,
          jobId,
          '.pdf',
        );
      }
    } catch {
      expectedResumeName = null;
    }

    return {
      id: String(task.jobId || task.id),
      taskId: String(task.id),
      companyName,
      title,
      jdUrl: task.applyUrl || '',
      resumeFolderName: profileBase,
      expectedResumeName,
      canonicalResumeStem: expectedResumeName
        ? expectedResumeName.replace(/\.pdf$/i, '')
        : null,
      status,
      sessionId: task.recording?.sessionId || task.sessionMatch?.sessionId || null,
      appliedAt: task.completedAt || null,
      athensJobId: task.jobId ? String(task.jobId) : null,
      matchScore: task.matchScore ?? null,
      source: task.source || '',
      hasRecording: Boolean(task.recording?.storagePath),
      hasGeneratedResume: false,
      bidderInProcess: Boolean(task.bidderInProcess),
      rejectReason: typeof task.rejectReason === 'string' ? task.rejectReason : null,
      rejectSource: task.rejectSource || null,
      resubmitCount: Number(task.resubmitCount || 0) || 0,
      resumeMismatch: Boolean(task.resumeMismatch),
      resumeOriginalName: task.resumeOriginalName || null,
      resumeExpectedName: task.resumeExpectedName || null,
    };
  }

  async function fetchBidReadyPools(applierName, apiUrl, options = {}) {
    const name = String(applierName || '').trim();
    if (!name) throw new Error('Athens applier name is required.');

    const data = await fetchJson(`/vendor/tasks?applierName=${encodeURIComponent(name)}`, {
      apiUrl,
      timeoutMs: options.timeoutMs ?? QUEUE_TIMEOUT_MS,
    });
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    // Open Bid Ready queue only — Submitted / Skipped / Rejected leave the monitor list.
    // Mark-fixed → submitted/done must NOT reappear here.
    const open = tasks.filter(
      (t) =>
        t.reviewStatus !== 'rejected' &&
        t.reviewStatus !== 'submitted' &&
        t.reviewStatus !== 'reviewed' &&
        t.status !== 'skipped' &&
        t.status !== 'done' &&
        t.progress !== 'completed' &&
        t.progress !== 'skipped',
    );
    const jobs = open.map((t) => mapTaskToJob(t, name));

    if (options.includeResumeStatus) {
      const resumeJobIds = [
        ...new Set(jobs.map((j) => j.athensJobId || j.id).filter(Boolean)),
      ];
      let withResume = new Set();
      if (resumeJobIds.length) {
        try {
          withResume = await checkGeneratedResumes(name, resumeJobIds, {
            timeoutMs: options.timeoutMs ?? QUEUE_TIMEOUT_MS,
          });
        } catch (err) {
          console.warn('Bid Monitor: résumé status check failed', err);
        }
      }
      for (const job of jobs) {
        const rid = String(job.athensJobId || job.id);
        job.hasGeneratedResume = withResume.has(rid);
      }
    }

    return [
      {
        id: 'athens-bid-ready',
        name: 'Bid Ready',
        status: 'active',
        profileName: name,
        source: 'athens',
        jobs,
      },
    ];
  }

  async function startBid(applierName, { jobId, sessionId, bidderName, applyUrl }) {
    return fetchJson('/bid-results/start', {
      method: 'POST',
      body: {
        applierName,
        jobId,
        sessionId: sessionId || undefined,
        bidderName: bidderName || undefined,
        applyUrl: applyUrl || undefined,
      },
      timeoutMs: QUEUE_TIMEOUT_MS,
    });
  }

  async function sha256Hex(blob) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function putResumable(uploadUrl, blob) {
    const chunkSize = 8 * 1024 * 1024;
    let offset = 0;
    while (offset < blob.size) {
      const end = Math.min(offset + chunkSize, blob.size);
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(end - offset),
          'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}`,
        },
        body: blob.slice(offset, end),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (response.status !== 308 && !response.ok) {
        throw new Error(`Storage upload failed (${response.status})`);
      }
      offset = end;
    }
  }

  async function uploadRecording(applierName, payload) {
    if (!(payload.blob instanceof Blob) || payload.blob.size === 0) throw new Error('Recording blob is required.');
    const sha256 = await sha256Hex(payload.blob);
    const started = await fetchJson('/bid-recordings/uploads', {
      method: 'POST',
      body: {
        applierName,
        jobId: payload.jobId,
        sessionId: payload.sessionId,
        applyUrl: payload.applyUrl || undefined,
        bidderName: payload.bidderName || undefined,
        contentType: payload.contentType || 'video/webm',
        fileName: payload.fileName || undefined,
        byteCount: payload.blob.size,
        sha256,
      },
      timeoutMs: QUEUE_TIMEOUT_MS,
    });
    await putResumable(started.uploadUrl, payload.blob);
    return fetchJson(`/bid-recordings/uploads/${encodeURIComponent(started.uploadId)}/complete`, {
      method: 'POST',
      body: {
        applyUrl: payload.applyUrl || undefined,
        bidderName: payload.bidderName || undefined,
        durationSec: payload.durationSec ?? undefined,
        recordedStartAt: payload.recordedStartAt ?? undefined,
        recordedEndAt: payload.recordedEndAt ?? undefined,
        markCompleted: Boolean(payload.markCompleted),
      },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  }

  async function completeBid(applierName, { jobId, bidderName }) {
    return fetchJson('/bid-results/complete', {
      method: 'POST',
      body: { applierName, jobId, bidderName: bidderName || undefined },
      timeoutMs: QUEUE_TIMEOUT_MS,
    });
  }

  async function skipBid(applierName, { jobId, bidderName }) {
    return fetchJson('/bid-results/skip', {
      method: 'POST',
      body: { applierName, jobId, bidderName: bidderName || undefined },
      timeoutMs: QUEUE_TIMEOUT_MS,
    });
  }

  /**
   * Rejected bids for Bid-Monitor Rejected workspace (not mixed with Bid Ready).
   */
  async function fetchRejectedBids(applierName, apiUrl, options = {}) {
    const name = String(applierName || '').trim();
    if (!name) throw new Error('Athens applier name is required.');
    const data = await fetchJson(
      `/bid-results/rejected?applierName=${encodeURIComponent(name)}`,
      {
        apiUrl,
        timeoutMs: options.timeoutMs ?? QUEUE_TIMEOUT_MS,
      },
    );
    const results = Array.isArray(data.results) ? data.results : [];
    return results.map((r) => {
      const company =
        typeof r.job?.company === 'string'
          ? r.job.company
          : r.job?.company?.name || 'Unknown company';
      return {
        id: String(r.jobId || r.taskId || r.id),
        taskId: r.taskId ? String(r.taskId) : null,
        athensJobId: r.jobId ? String(r.jobId) : null,
        companyName: company || 'Unknown company',
        title: r.job?.title || 'Untitled role',
        jdUrl: r.job?.applyUrl || '',
        rejectReason:
          typeof r.rejectReason === 'string' && r.rejectReason.trim()
            ? r.rejectReason.trim()
            : null,
        rejectSource:
          r.rejectSource === 'submitted' || r.rejectSource === 'skipped'
            ? r.rejectSource
            : null,
        rejectCount: Number(r.rejectCount || 0) || 0,
        resubmitCount: Number(r.resubmitCount || 0) || 0,
        rejectedAt: r.lastRejectedAt || r.submittedAt || null,
        resumeMismatch: Boolean(r.resumeMismatch),
        resumeOriginalName: r.resumeOriginalName || null,
        resumeExpectedName: r.resumeExpectedName || null,
      };
    });
  }

  /**
   * Vendor mark-fixed: rejected → submitted. Does not return item to Bid Ready.
   */
  async function markBidFixed(applierName, { jobId, id } = {}) {
    const name = String(applierName || '').trim();
    const raw = String(jobId || id || '').trim();
    if (!name || !raw) throw new Error('applierName and jobId (or id) are required.');
    return fetchJson('/bid-results/mark-fixed', {
      method: 'POST',
      body: {
        applierName: name,
        jobId: raw,
        id: raw,
      },
      timeoutMs: QUEUE_TIMEOUT_MS,
    });
  }

  async function saveResumeAudit(applierName, payload) {
    return fetchJson('/bid-results/resume-audit', {
      method: 'POST',
      body: {
        applierName,
        jobId: payload.jobId,
        originalName: payload.originalName,
        expectedName: payload.expectedName || undefined,
        cleanedName: payload.cleanedName || undefined,
        renamed: payload.renamed,
        company: payload.company || undefined,
        title: payload.title || undefined,
        pageUrl: payload.pageUrl || undefined,
        sessionId: payload.sessionId || undefined,
        source: payload.source || undefined,
        fileSize: Number.isFinite(payload.fileSize) ? payload.fileSize : undefined,
        lastModified: Number.isFinite(payload.lastModified) ? payload.lastModified : undefined,
        mimeType: payload.mimeType || undefined,
        auditKey: payload.auditKey || undefined,
      },
      timeoutMs: QUEUE_TIMEOUT_MS,
    });
  }

  async function getResumesZipUrl(applierName, jobIds) {
    const settings = await getSettings();
    const base = settings.apiUrl.replace(/\/$/, '');
    const params = new URLSearchParams({ applierName });
    if (Array.isArray(jobIds) && jobIds.length) {
      params.set('jobIds', jobIds.join(','));
    }
    return `${base}/bid-results/resumes.zip?${params}`;
  }

  /**
   * Fetch résumé zip as a Blob via POST (avoids long GET query strings that
   * break chrome.downloads on Windows). Returns { blob, fileName }.
   */
  async function fetchResumesZip(applierName, jobIds) {
    const settings = await getSettings();
    const base = settings.apiUrl.replace(/\/$/, '');
    const url = `${base}/bid-results/resumes.zip`;
    const idToken = typeof AuthSession !== 'undefined' ? await AuthSession.getIdToken() : '';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        applierName,
        jobIds: Array.isArray(jobIds) ? jobIds.map(String).filter(Boolean) : [],
      }),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      let message = `Résumé zip failed (${response.status})`;
      try {
        const data = await response.json();
        if (data?.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const matched = /filename="([^"]+)"/i.exec(disposition);
    const safeApplier = String(applierName).replace(/[^\w.\-()+ ]+/g, '_').trim() || 'resumes';
    const fileName = matched?.[1] || `${safeApplier}-bid-resumes.zip`;
    return { blob, fileName };
  }

  async function saveBidFlags(applierName, { jobId, flags, summary }) {
    return fetchJson('/bid-results/flags', {
      method: 'POST',
      body: {
        applierName,
        jobId,
        flags: flags || undefined,
        summary: summary || undefined,
      },
      timeoutMs: QUEUE_TIMEOUT_MS,
    });
  }

  async function analyzeJobPage(applierName, { pageContext, sessionContext, jobId }) {
    return fetchJson('/job-analyze/page', {
      method: 'POST',
      body: {
        applierName,
        pageContext,
        sessionContext: sessionContext || undefined,
        jobId: jobId || undefined,
      },
      timeoutMs: ANALYZE_TIMEOUT_MS,
    });
  }

  async function analyzeJobFlags(applierName, { pageContext, sessionContext, neededFlags, jobId }) {
    return fetchJson('/job-analyze/flags', {
      method: 'POST',
      body: {
        applierName,
        pageContext,
        sessionContext: sessionContext || undefined,
        neededFlags: neededFlags || ['remote', 'clearance'],
        jobId: jobId || undefined,
      },
      timeoutMs: ANALYZE_TIMEOUT_MS,
    });
  }

  async function recommendResume(applierName, { pageContext, jobId }) {
    return fetchJson('/job-analyze/recommend-resume', {
      method: 'POST',
      body: {
        applierName,
        pageContext,
        jobId: jobId || undefined,
      },
      timeoutMs: ANALYZE_TIMEOUT_MS,
    });
  }

  async function checkAthensHealth() {
    const settings = await getSettings();
    const base = settings.apiUrl.replace(/\/$/, '');
    // Lightweight ping — do NOT use /bid-results (slow, large payload → false "down").
    try {
      const idToken = typeof AuthSession !== 'undefined' ? await AuthSession.getIdToken() : '';
      const response = await fetch(`${base}/agents/health`, {
        method: 'GET',
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
        signal: AbortSignal.timeout(5000),
      });
      return {
        ok: true,
        healthy: response.ok,
        apiUrl: settings.apiUrl,
        status: response.status,
        error: response.ok ? null : `Athens health check failed (HTTP ${response.status}).`,
      };
    } catch (err) {
      return {
        ok: false,
        healthy: false,
        apiUrl: settings.apiUrl,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function checkGeneratedResumes(applierName, jobIds, options = {}) {
    const data = await fetchJson('/personal/agent-job-resumes/status', {
      method: 'POST',
      body: { applierName, jobIds },
      timeoutMs: options.timeoutMs ?? QUEUE_TIMEOUT_MS,
    });
    return new Set(Array.isArray(data.jobIds) ? data.jobIds.map(String) : []);
  }

  async function getResumePdfUrl(applierName, jobId) {
    const settings = await getSettings();
    const base = settings.apiUrl.replace(/\/$/, '');
    const params = new URLSearchParams({ applierName });
    return `${base}/personal/agent-job-resume/${encodeURIComponent(jobId)}/pdf?${params}`;
  }

  async function fetchResumePdf(applierName, jobId) {
    const url = await getResumePdfUrl(applierName, jobId);
    const idToken = typeof AuthSession !== 'undefined' ? await AuthSession.getIdToken() : '';
    const response = await fetch(url, {
      headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      let message = `Draft PDF unavailable (${response.status})`;
      try {
        const data = await response.json();
        if (data?.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const matched = /filename="([^"]+)"/i.exec(disposition);
    let fileName = matched?.[1] || `${String(applierName).replace(/[^\w.\-()+ ]+/g, '_')}.pdf`;
    fileName = fileName.replace(/-[a-f0-9]{8}(?=\.pdf$)/i, '');
    if (!fileName.toLowerCase().endsWith('.pdf')) fileName = `${fileName}.pdf`;
    return { blob, fileName, mimeType: 'application/pdf' };
  }

  async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  return {
    DEFAULT_API_URL,
    QUEUE_TIMEOUT_MS,
    UPLOAD_TIMEOUT_MS,
    ANALYZE_TIMEOUT_MS,
    getSettings,
    saveSettings,
    fetchBidReadyPools,
    fetchRejectedBids,
    markBidFixed,
    saveResumeAudit,
    getResumesZipUrl,
    fetchResumesZip,
    startBid,
    uploadRecording,
    completeBid,
    skipBid,
    saveBidFlags,
    analyzeJobPage,
    analyzeJobFlags,
    recommendResume,
    checkAthensHealth,
    checkGeneratedResumes,
    getResumePdfUrl,
    fetchResumePdf,
    blobToBase64,
    mapTaskToJob,
  };
})();
