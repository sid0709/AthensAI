const loginView = document.getElementById('loginView');
const workspaceView = document.getElementById('workspaceView');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const applierNameInput = document.getElementById('applierName');
const loginError = document.getElementById('loginError');
/** From config.js (local .env / CI VPS_HOST via pack). */
const ATHENS_API_URL =
  (typeof BidMonitorConfig !== 'undefined' && BidMonitorConfig.ATHENS_API_URL) ||
  'http://127.0.0.1:8979/api';
const signInBtn = document.getElementById('signInBtn');
const profileNameEl = document.getElementById('profileName');
const roleBadgeEl = document.getElementById('roleBadge');
const bridgeBadgeEl = document.getElementById('bridgeBadge');
const completedTodayEl = document.getElementById('completedToday');
const signOutBtn = document.getElementById('signOutBtn');
const jobList = document.getElementById('jobList');
const refreshQueueBtn = document.getElementById('refreshQueueBtn');
const downloadResumesZipBtn = document.getElementById('downloadResumesZipBtn');
const queueHint = document.getElementById('queueHint');
const queueSection = document.getElementById('queueSection');
const rejectedSection = document.getElementById('rejectedSection');
const rejectedList = document.getElementById('rejectedList');
const rejectedHint = document.getElementById('rejectedHint');
const refreshRejectedBtn = document.getElementById('refreshRejectedBtn');
const rejectedCountBadge = document.getElementById('rejectedCountBadge');
const workspaceTabs = document.getElementById('workspaceTabs');
const applySessionView = document.getElementById('applySessionView');
const applyJobCompany = document.getElementById('applyJobCompany');
const applyJobTitle = document.getElementById('applyJobTitle');
const applyResumeFolder = document.getElementById('applyResumeFolder');
const applyResumeFileNameRow = document.getElementById('applyResumeFileNameRow');
const applyResumeFileName = document.getElementById('applyResumeFileName');
const applyCopyResumeNameBtn = document.getElementById('applyCopyResumeNameBtn');
const applySessionStatus = document.getElementById('applySessionStatus');
const applySessionError = document.getElementById('applySessionError');
const applyModeBadge = document.getElementById('applyModeBadge');
const startRecordBlock = document.getElementById('startRecordBlock');
const startRecordingBtn = document.getElementById('startRecordingBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const openJobBtn = document.getElementById('openJobBtn');
const reopenJobBtn = document.getElementById('reopenJobBtn');
const screeningPanel = document.getElementById('screeningPanel');
const lightJd = document.getElementById('lightJd');
const lightRemote = document.getElementById('lightRemote');
const lightClearance = document.getElementById('lightClearance');
const analyzeStatus = document.getElementById('analyzeStatus');
const summaryDetails = document.getElementById('summaryDetails');
const analyzeSummary = document.getElementById('analyzeSummary');
const flagExplanations = document.getElementById('flagExplanations');
const recommendResumeBtn = document.getElementById('recommendResumeBtn');
const recommendResumeResult = document.getElementById('recommendResumeResult');
const recommendResumeWarning = document.getElementById('recommendResumeWarning');
const formAnswersDetails = document.getElementById('formAnswersDetails');
const formAnswersCount = document.getElementById('formAnswersCount');
const formAnswersList = document.getElementById('formAnswersList');
const applyResumeActions = document.getElementById('applyResumeActions');
const applyViewResumeBtn = document.getElementById('applyViewResumeBtn');
const applyDownloadResumeBtn = document.getElementById('applyDownloadResumeBtn');
const finishFooter = document.getElementById('finishFooter');
const finishHint = document.getElementById('finishHint');
const submitRecordingBtn = document.getElementById('submitRecordingBtn');
const skipRecordingBtn = document.getElementById('skipRecordingBtn');
const recordingsView = document.getElementById('recordingsView');
const recordingsList = document.getElementById('recordingsList');
const statusStrip = document.getElementById('statusStrip');
const statusStripText = document.getElementById('statusStripText');
const formatOptions = [...document.querySelectorAll('.format-option')];

let dashboardState = { auth: null, pools: [] };
let currentTabId = null;
let applyTabId = null;
let activeJobId = null;
let currentTabState = null;
let recordingSessions = [];
let persistedAnalysis = null;
let completedTodayCount = 0;
let applyResumeJobId = null;
let applyResumeCheckToken = 0;
let queueLoading = false;
let workspacePage = 'ready';
let rejectedJobs = [];
let rejectedLoading = false;

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

/** Canonical upload name — same stem as bulk zip + .pdf */
function resolveExpectedResumeFileName(job) {
  const fromJob = String(job?.expectedResumeName || '').trim();
  if (fromJob) return fromJob;

  if (typeof CanonicalResumeName === 'undefined') return null;
  const company = job?.companyName;
  const title = job?.title;
  const profile =
    dashboardState?.auth?.displayName ||
    dashboardState?.auth?.applierName ||
    profileNameEl?.textContent?.trim();
  const jobId = job?.athensJobId || job?.id;
  if (!company || !title || !profile || !jobId || profile === '—') return null;
  try {
    return CanonicalResumeName.buildCanonicalResumeFileName(
      company,
      title,
      profile,
      jobId,
      '.pdf',
    );
  } catch {
    return null;
  }
}

function resumeFileNameMarkup(fileName) {
  if (!fileName) return '';
  return `
    <div class="resume-filename-row" title="${escapeHtml(fileName)}">
      <span class="resume-filename-label">Upload as</span>
      <code class="resume-filename mono">${escapeHtml(fileName)}</code>
      <button type="button" class="btn-copy-filename" data-copy-filename="${escapeHtml(fileName)}" title="Copy filename">Copy</button>
    </div>
  `;
}

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function bindCopyFilenameButtons(root) {
  root?.querySelectorAll('[data-copy-filename]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const name = button.dataset.copyFilename || '';
      const ok = await copyTextToClipboard(name);
      const prev = button.textContent;
      button.textContent = ok ? 'Copied' : 'Failed';
      setTimeout(() => {
        button.textContent = prev;
      }, 1200);
    });
  });
}

function setApplyResumeFileName(job) {
  const fileName = resolveExpectedResumeFileName(job);
  if (!applyResumeFileNameRow || !applyResumeFileName) return;
  if (!fileName) {
    applyResumeFileNameRow.classList.add('hidden');
    applyResumeFileName.textContent = '';
    applyResumeFileName.removeAttribute('title');
    return;
  }
  applyResumeFileName.textContent = fileName;
  applyResumeFileName.title = fileName;
  applyResumeFileNameRow.classList.remove('hidden');
}

async function getCurrentTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

function showLoginError(message) {
  if (!message) {
    loginError.classList.add('hidden');
    loginError.textContent = '';
    return;
  }
  loginError.textContent = message;
  loginError.classList.remove('hidden');
}

function getSelectedVideoFormat() {
  const active = formatOptions.find((button) => button.classList.contains('active'));
  return active?.dataset.format === 'mp4' ? 'mp4' : 'webm';
}

function setSelectedVideoFormat(format) {
  const normalized = format === 'mp4' ? 'mp4' : 'webm';
  for (const button of formatOptions) {
    button.classList.toggle('active', button.dataset.format === normalized);
  }
  chrome.storage.local.set({ videoFormat: normalized });
}

function setLight(el, status) {
  if (!el) return;
  el.classList.remove('green', 'red', 'unknown');
  if (status === 'green' || status === 'red') el.classList.add(status);
  else el.classList.add('unknown');
}

function renderRecommend(recommend) {
  if (!recommendResumeResult || !recommendResumeWarning) return;

  if (!recommend) {
    recommendResumeResult.classList.add('hidden');
    recommendResumeResult.textContent = '';
    recommendResumeWarning.classList.add('hidden');
    recommendResumeWarning.textContent = '';
    return;
  }

  if (recommend.warning && !recommend.isJobDescription) {
    recommendResumeResult.textContent = 'None';
    recommendResumeResult.classList.remove('hidden');
    recommendResumeWarning.textContent = recommend.warning;
    recommendResumeWarning.classList.remove('hidden');
    return;
  }

  if (recommend.recommendedResume) {
    recommendResumeResult.textContent = recommend.recommendedResume;
    recommendResumeResult.classList.remove('hidden');
  } else if (recommend.useCustomizedResume) {
    recommendResumeResult.textContent = 'Use customized resume';
    recommendResumeResult.classList.remove('hidden');
  } else {
    recommendResumeResult.textContent = 'None';
    recommendResumeResult.classList.remove('hidden');
  }

  if (recommend.warning) {
    recommendResumeWarning.textContent = recommend.warning;
    recommendResumeWarning.classList.remove('hidden');
  } else if (recommend.reason) {
    recommendResumeWarning.textContent = recommend.reason;
    recommendResumeWarning.classList.remove('hidden');
  } else {
    recommendResumeWarning.classList.add('hidden');
    recommendResumeWarning.textContent = '';
  }
}

function renderAnalysis(data) {
  if (!data) {
    screeningPanel?.classList.add('hidden');
    setLight(lightJd, 'unknown');
    setLight(lightRemote, 'unknown');
    setLight(lightClearance, 'unknown');
    analyzeStatus?.classList.add('hidden');
    summaryDetails?.classList.add('hidden');
    if (flagExplanations) flagExplanations.innerHTML = '';
    formAnswersDetails?.classList.add('hidden');
    if (formAnswersList) formAnswersList.innerHTML = '';
    if (recommendResumeBtn) recommendResumeBtn.disabled = true;
    renderRecommend(null);
    return;
  }

  screeningPanel?.classList.remove('hidden');
  setLight(lightJd, data.jdAnalyzed ? 'green' : 'unknown');
  setLight(lightRemote, data.flags?.remote?.status);
  setLight(lightClearance, data.flags?.clearance?.status);
  if (recommendResumeBtn) recommendResumeBtn.disabled = !data.jdAnalyzed;
  renderRecommend(data.recommend || null);

  if (data.summary) {
    summaryDetails?.classList.remove('hidden');
    if (analyzeSummary) analyzeSummary.textContent = data.summary;
  } else {
    summaryDetails?.classList.add('hidden');
  }

  const reds = [];
  if (data.flags?.remote?.status === 'red') {
    reds.push(`Remote: ${data.flags.remote.explanation || 'Not remote-friendly'}`);
  }
  if (data.flags?.clearance?.status === 'red') {
    reds.push(`Clearance: ${data.flags.clearance.explanation || 'Clearance required'}`);
  }
  if (flagExplanations) {
    flagExplanations.innerHTML = reds.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  }

  const answers = Array.isArray(data.formAnswers) ? data.formAnswers : [];
  if (answers.length) {
    formAnswersDetails?.classList.remove('hidden');
    if (formAnswersCount) {
      formAnswersCount.textContent = `(${answers.length})`;
    }
    if (formAnswersList) {
      formAnswersList.innerHTML = answers
        .map((a) => {
          const conf = String(a.confidence || '').toLowerCase();
          const confClass = conf === 'high' || conf === 'medium' || conf === 'low' ? conf : '';
          const confBadge = confClass
            ? `<span class="answer-confidence ${confClass}">${escapeHtml(conf)}</span>`
            : '';
          return `<li class="answer-item">
            <div class="answer-q">${escapeHtml(a.question || '')}${confBadge}</div>
            <div class="answer-a">${escapeHtml(a.suggestedAnswer || '')}</div>
          </li>`;
        })
        .join('');
    }
  } else {
    formAnswersDetails?.classList.add('hidden');
    if (formAnswersList) formAnswersList.innerHTML = '';
  }

  if (analyzeStatus) {
    if (data.error) {
      analyzeStatus.textContent = data.error;
      analyzeStatus.classList.remove('hidden');
    } else {
      const parts = [];
      if (answers.length) {
        parts.push(`${answers.length} suggested answers`);
      }
      if (data.charCount) {
        parts.push(`${data.charCount.toLocaleString()} chars`);
      }
      analyzeStatus.textContent = parts.length ? parts.join(' · ') : 'Analysis complete';
      analyzeStatus.classList.remove('hidden');
    }
  }
}

async function refreshApplyResume(job) {
  const jobId = job?.athensJobId || job?.id || null;
  applyResumeJobId = jobId ? String(jobId) : null;

  if (!applyResumeJobId) {
    applyResumeActions?.classList.add('hidden');
    return;
  }

  if (job?.hasGeneratedResume) {
    applyResumeActions?.classList.remove('hidden');
  }

  const token = ++applyResumeCheckToken;
  try {
    const res = await sendMessage({ type: 'CHECK_JOB_RESUME', jobId: applyResumeJobId });
    if (token !== applyResumeCheckToken) return;
    if (res?.ok && res.hasResume) {
      applyResumeActions?.classList.remove('hidden');
    } else if (!job?.hasGeneratedResume) {
      applyResumeActions?.classList.add('hidden');
    }
  } catch {
    if (token === applyResumeCheckToken && !job?.hasGeneratedResume) {
      applyResumeActions?.classList.add('hidden');
    }
  }
}

function resolveFinishTabId() {
  return (
    applyTabId ||
    currentTabState?.tabId ||
    currentTabState?.session?.tabId ||
    currentTabId
  );
}

function renderApplySession(state) {
  const job = state?.applyJob;
  const isRec = Boolean(state?.isRecording);
  const hasPending = Boolean(job) && !isRec;
  const finishable = isRec || hasPending;
  const hasCard = Boolean(job) || isRec;
  const tabMissing = Boolean(state?.tabMissing);

  applyTabId = state?.tabId ?? (isRec ? state?.session?.tabId : null) ?? null;
  activeJobId = state?.jobId || job?.id || job?.athensJobId || null;
  persistedAnalysis = state?.analysis || persistedAnalysis;

  applySessionView.classList.toggle('hidden', !hasCard);
  if (!hasCard) {
    finishFooter?.classList.add('hidden');
    statusStrip.className = 'status-strip idle';
    statusStripText.textContent = 'Select a Bid Ready job to apply';
    reopenJobBtn?.classList.add('hidden');
    renderAnalysis(null);
    return;
  }

  applyJobCompany.textContent = job?.companyName ?? 'This tab';
  applyJobTitle.textContent = job?.title ?? '';
  applyResumeFolder.textContent = job?.resumeFolderName
    ? `Resume: ${job.resumeFolderName}`
    : '';
  setApplyResumeFileName(job);

  refreshApplyResume(job);

  applySessionView.classList.toggle('recording', isRec);
  applyModeBadge.textContent = isRec ? 'Recording' : 'Ready to record';
  applyModeBadge.className = `mode-badge ${isRec ? 'recording' : 'ready'}`;

  reopenJobBtn?.classList.toggle('hidden', !tabMissing && Boolean(applyTabId));

  if (isRec) {
    statusStrip.className = 'status-strip recording';
    statusStripText.textContent = 'Recording — Submit or Skip when done';
    applySessionStatus.textContent =
      'Video capture is active. Finish with Submit (uploaded) or Skip.';
    startRecordBlock?.classList.add('hidden');
    if (finishHint) {
      finishHint.textContent =
        'Stops recording. Submit → Submitted · Skip → Skipped.';
    }
  } else if (tabMissing) {
    statusStrip.className = 'status-strip ready';
    statusStripText.textContent = 'In process — reopen the job tab to continue';
    applySessionStatus.textContent =
      'Job tab was closed. Reopen the application page to record or Analyze.';
    startRecordBlock?.classList.add('hidden');
  } else {
    statusStrip.className = 'status-strip ready';
    statusStripText.textContent = 'Ready to record — or Submit / Skip without video';
    applySessionStatus.textContent =
      'Job is In process. Start recording from the toolbar, or finish without video.';
    startRecordBlock?.classList.remove('hidden');
    if (finishHint) {
      finishHint.textContent =
        'Skip or Submit without recording also updates Bid Management. Prefer recording when possible.';
    }
  }

  applySessionError.classList.add('hidden');
  finishFooter?.classList.toggle('hidden', !finishable);
  if (submitRecordingBtn) {
    submitRecordingBtn.disabled = !finishable;
    submitRecordingBtn.textContent = isRec ? 'Submit' : 'Submit (no video)';
  }
  if (skipRecordingBtn) {
    skipRecordingBtn.disabled = !finishable;
    skipRecordingBtn.textContent = 'Skip this Job';
  }

  renderAnalysis(persistedAnalysis);
}

function renderRecordingsList() {
  const sessions = (recordingSessions ?? []).filter((s) => s.tabId);
  recordingsView.classList.toggle('hidden', sessions.length === 0);
  recordingsList.innerHTML = '';

  for (const session of sessions) {
    const li = document.createElement('li');
    const title = session.companyName
      ? `${session.companyName} — ${session.jobTitle ?? ''}`
      : session.startTitle || 'Recording';
    li.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <span class="meta-line">Recording…</span>
      <div class="item-actions">
        <button type="button" class="btn btn-primary" data-finish="submit" data-stop-tab="${session.tabId}">Submit</button>
        <button type="button" class="btn btn-muted" data-finish="skip" data-stop-tab="${session.tabId}">Skip</button>
      </div>
    `;
    recordingsList.appendChild(li);
  }

  recordingsList.querySelectorAll('[data-stop-tab]').forEach((button) => {
    button.addEventListener('click', () =>
      finishApply(Number(button.dataset.stopTab), button.dataset.finish || 'submit', button),
    );
  });
}

async function refreshApplySession() {
  currentTabId = await getCurrentTabId();
  const state = await sendMessage({ type: 'GET_ACTIVE_APPLY' });
  currentTabState = state?.ok ? state : null;
  if (state?.ok && state.analysis) persistedAnalysis = state.analysis;

  const ui = await sendMessage({ type: 'GET_UI_STATE' }).catch(() => null);
  if (ui?.ok) {
    recordingSessions = ui.recordingSessions ?? [];
    if (ui.activeApply?.analysis) persistedAnalysis = ui.activeApply.analysis;
  } else {
    const fullState = await sendMessage({ type: 'GET_STATE' }).catch(() => null);
    recordingSessions = fullState?.ok ? (fullState.recordingSessions ?? []) : [];
  }

  renderApplySession(currentTabState);
  renderRecordingsList();
}

function showRecordingInstructions() {
  alert(
    'Recording is silent (no screen-share dialog).\n\n'
      + '1. Focus the job application tab.\n'
      + '2. Click the Bid Monitor icon in the Chrome toolbar\n'
      + '   — or right-click → "Bid Monitor: Start / Stop recording this tab".\n\n'
      + 'Recording starts immediately. Use Submit or Skip in this panel to finish.',
  );
}

async function finishApply(tabId, finishAction = 'submit', button) {
  let resolveTabId = tabId;
  if (!resolveTabId && activeJobId) {
    const reopen = await sendMessage({ type: 'REOPEN_APPLY_TAB', jobId: activeJobId });
    resolveTabId = reopen?.tabId || null;
  }
  if (!resolveTabId) {
    alert('No active job tab. Open a Bid Ready job with Apply first.');
    return;
  }
  const action = finishAction === 'skip' ? 'skip' : 'submit';

  if (button) {
    button.disabled = true;
    button.textContent = action === 'skip' ? 'Skipping…' : 'Submitting…';
  }
  statusStrip.className = 'status-strip finishing';
  statusStripText.textContent = action === 'skip' ? 'Skipping…' : 'Submitting…';
  if (submitRecordingBtn) submitRecordingBtn.disabled = true;
  if (skipRecordingBtn) skipRecordingBtn.disabled = true;

  const response = await sendMessage({
    type: 'STOP_CAPTURE',
    tabId: resolveTabId,
    closeApplyTab: true,
    finishAction: action,
  });

  if (submitRecordingBtn) {
    submitRecordingBtn.disabled = false;
    submitRecordingBtn.textContent = 'Submit';
  }
  if (skipRecordingBtn) {
    skipRecordingBtn.disabled = false;
    skipRecordingBtn.textContent = 'Skip this Job';
  }

  if (!response?.ok) {
    alert(response?.error || 'Failed to finish job.');
    await refreshApplySession();
    return;
  }

  if (response.jobOutcome === 'submitted' || response.jobOutcome === 'skipped') {
    completedTodayCount += 1;
    updateCompletedPill();
    const todayKey = new Date().toISOString().slice(0, 10);
    await chrome.storage.local.set({
      bidMonitorCompletedDay: { dayKey: todayKey, count: completedTodayCount },
    });
  }

  if (response.uploadError || response.statusError) {
    alert(
      `Finished with a warning:\n${response.uploadError || response.statusError}`,
    );
  } else if (response.jobOutcome === 'skipped') {
    alert('Skipped. Ticket moved to Skipped in Bid Management.');
  } else if (response.jobOutcome === 'submitted') {
    alert(
      response.uploaded
        ? 'Submitted. Recording uploaded — ticket is Submitted.'
        : response.withoutRecording
          ? 'Submitted without video — ticket is Submitted.'
          : 'Submitted. Ticket is Submitted in Bid Management.',
    );
  }

  persistedAnalysis = null;
  activeJobId = null;
  await refreshApplySession();
  // Pull Athens queue so Submitted/Skipped disappear and statuses match Bid Management.
  await loadDashboard({ force: true });
}

function updateCompletedPill() {
  if (completedTodayEl) {
    completedTodayEl.textContent = `${completedTodayCount} today`;
  }
}

async function refreshBridgeBadge() {
  if (!bridgeBadgeEl) return;
  try {
    const res = await sendMessage({ type: 'CHECK_ATHENS' });
    if (res?.healthy) {
      bridgeBadgeEl.textContent = 'Athens OK';
      bridgeBadgeEl.className = 'bridge-badge ok';
      bridgeBadgeEl.removeAttribute('title');
    } else {
      bridgeBadgeEl.textContent = 'Athens down';
      bridgeBadgeEl.className = 'bridge-badge down';
      // Do not surface host/IP/URL in the UI (tooltip or label).
      bridgeBadgeEl.title = 'Cannot reach Athens right now.';
    }
  } catch {
    bridgeBadgeEl.textContent = 'Athens ?';
    bridgeBadgeEl.className = 'bridge-badge unknown';
    bridgeBadgeEl.removeAttribute('title');
  }
}

function getQueueJobs() {
  const pools = dashboardState.pools ?? [];
  const jobs = [];
  for (const pool of pools) {
    for (const job of pool.jobs ?? []) {
      // Submitted / Skipped / Rejected leave Bid Ready (Rejected has its own page).
      if (
        job.status === 'applied' ||
        job.status === 'skipped' ||
        job.status === 'rejected'
      ) {
        continue;
      }
      jobs.push({ ...job, poolId: pool.id });
    }
  }
  const rank = (status) => (status === 'in_process' ? 0 : 1);
  jobs.sort((a, b) => rank(a.status) - rank(b.status));
  return jobs;
}

function statusBadgeFor(job) {
  if (job.status === 'in_process') {
    return { statusClass: 'status-active', statusLabel: 'In process' };
  }
  return { statusClass: 'status-open', statusLabel: 'Pending' };
}

function setQueueHint() {
  if (!queueHint) return;
  if (queueLoading) {
    queueHint.textContent = 'Loading Bid Ready queue…';
    return;
  }
  if (dashboardState.fromCache && dashboardState.refreshing) {
    queueHint.textContent = 'Refreshing queue…';
    return;
  }
  queueHint.textContent = 'Pending until Apply → In process (same as Athens)';
}

function renderQueue() {
  jobList.innerHTML = '';
  setQueueHint();

  if (dashboardState.athensError) {
    const errLi = document.createElement('li');
    errLi.className = 'empty';
    errLi.textContent = `Athens: ${dashboardState.athensError}`;
    jobList.appendChild(errLi);
  }

  if (queueLoading && !getQueueJobs().length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Loading Bid Ready jobs…';
    jobList.appendChild(empty);
    return;
  }

  const jobs = getQueueJobs();
  if (!jobs.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent =
      'No Bid Ready jobs. Mark jobs Bid ready in Athens Job Search.';
    jobList.appendChild(empty);
    return;
  }

  for (const job of jobs) {
    const li = document.createElement('li');
    const { statusClass, statusLabel } = statusBadgeFor(job);
    const inProcess = job.status === 'in_process';
    const resumeJobId = job.athensJobId || job.id;
    const expectedName = resolveExpectedResumeFileName(job);
    const resumeActions = job.hasGeneratedResume
      ? `
        <button type="button" class="btn btn-secondary" data-view-resume="${escapeHtml(resumeJobId)}">View résumé</button>
        <button type="button" class="btn btn-secondary" data-download-resume="${escapeHtml(resumeJobId)}">Download</button>
      `
      : '';
    // Apply only while Pending; In process jobs are already started.
    const applyAction = inProcess
      ? ''
      : `<button type="button" class="btn btn-apply" data-apply-job="${job.id}" data-pool="${job.poolId}">Apply</button>`;

    li.innerHTML = `
      <strong>${escapeHtml(job.companyName)}</strong>
      <span class="meta-line">${escapeHtml(job.title)}</span>
      ${resumeFileNameMarkup(expectedName)}
      <span class="status-badge ${statusClass}">${statusLabel}</span>
      <div class="item-actions">
        ${resumeActions}
        ${applyAction}
      </div>
    `;
    jobList.appendChild(li);
  }

  bindCopyFilenameButtons(jobList);

  jobList.querySelectorAll('[data-view-resume]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const response = await sendMessage({
          type: 'OPEN_JOB_RESUME',
          jobId: button.dataset.viewResume,
        });
        if (!response?.ok) alert(response?.error || 'Failed to open résumé.');
      } catch (err) {
        alert(err.message || 'Failed to open résumé.');
      } finally {
        button.disabled = false;
      }
    });
  });

  jobList.querySelectorAll('[data-download-resume]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const prev = button.textContent;
      button.textContent = 'Downloading…';
      try {
        const response = await sendMessage({
          type: 'DOWNLOAD_JOB_RESUME',
          jobId: button.dataset.downloadResume,
        });
        if (!response?.ok) alert(response?.error || 'Failed to download résumé.');
      } catch (err) {
        alert(err.message || 'Failed to download résumé.');
      } finally {
        button.disabled = false;
        button.textContent = prev;
      }
    });
  });

  jobList.querySelectorAll('[data-apply-job]').forEach((button) => {
    button.addEventListener('click', () => {
      const jobId = button.dataset.applyJob;
      const poolId = button.dataset.pool;
      const pool = (dashboardState.pools ?? []).find((p) => p.id === poolId);
      const job = pool?.jobs?.find((item) => item.id === jobId);
      if (!job || !pool) return;

      button.disabled = true;
      button.textContent = 'Opening…';

      // Optimistic In process badge.
      job.status = 'in_process';
      renderQueue();

      chrome.tabs.create({ url: job.jdUrl, active: true }, (tab) => {
        if (chrome.runtime.lastError || !tab?.id) {
          alert(chrome.runtime.lastError?.message || 'Failed to open job tab.');
          job.status = 'pending';
          button.disabled = false;
          button.textContent = 'Apply';
          renderQueue();
          return;
        }

        sendMessage({
          type: 'APPLY_OPEN_JOB',
          tabId: tab.id,
          poolId: pool.id,
          jobId: job.id,
        })
          .then(async (response) => {
            if (!response?.ok) {
              alert(response?.error || 'Failed to open job application.');
              job.status = 'pending';
              button.disabled = false;
              button.textContent = 'Apply';
              renderQueue();
              return;
            }
            button.disabled = false;
            button.textContent = 'Apply';
            // Prefer fresh Athens status after startBid (bidderInProcess).
            await loadDashboard({ force: true });
            await refreshApplySession();
            applySessionView.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            startRecordingBtn?.classList.add('pulse');
            setTimeout(() => startRecordingBtn?.classList.remove('pulse'), 2000);
          })
          .catch((err) => {
            alert(err.message || 'Failed to open job application.');
            job.status = 'pending';
            button.disabled = false;
            button.textContent = 'Apply';
            renderQueue();
          });
      });
    });
  });
}

function setWorkspacePage(page) {
  workspacePage = page === 'rejected' ? 'rejected' : 'ready';
  queueSection?.classList.toggle('hidden', workspacePage !== 'ready');
  rejectedSection?.classList.toggle('hidden', workspacePage !== 'rejected');
  workspaceTabs?.querySelectorAll('.workspace-tab').forEach((btn) => {
    const active = btn.dataset.tab === workspacePage;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (workspacePage === 'rejected') {
    loadRejected().catch(() => {});
  }
}

function renderRejected() {
  if (!rejectedList) return;
  rejectedList.innerHTML = '';

  if (rejectedHint) {
    rejectedHint.textContent = rejectedLoading
      ? 'Loading rejected bids…'
      : 'Mark fixed → Submitted (no re-record). Reason shown when provided.';
  }

  if (rejectedCountBadge) {
    const n = rejectedJobs.length;
    rejectedCountBadge.textContent = String(n);
    rejectedCountBadge.classList.toggle('hidden', n === 0);
  }

  if (rejectedLoading && !rejectedJobs.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Loading rejected bids…';
    rejectedList.appendChild(empty);
    return;
  }

  if (!rejectedJobs.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No rejected bids. You’re clear.';
    rejectedList.appendChild(empty);
    return;
  }

  for (const job of rejectedJobs) {
    const li = document.createElement('li');
    const reason = job.rejectReason
      ? escapeHtml(job.rejectReason)
      : 'No reason provided';
    const source =
      job.rejectSource === 'skipped'
        ? 'From skipped'
        : job.rejectSource === 'submitted'
          ? 'From submitted'
          : '';
    const mismatch = job.resumeMismatch
      ? `<span class="status-badge status-rejected">Name mismatch</span>`
      : '';
    li.innerHTML = `
      <strong>${escapeHtml(job.companyName)}</strong>
      <span class="meta-line">${escapeHtml(job.title)}</span>
      <span class="status-badge status-rejected">Rejected</span>
      ${mismatch}
      ${source ? `<span class="meta-line">${escapeHtml(source)}</span>` : ''}
      <span class="reject-reason ${job.rejectReason ? '' : 'empty'}">${reason}</span>
      <div class="item-actions">
        <button type="button" class="btn btn-primary" data-mark-fixed="${escapeHtml(job.athensJobId || job.id)}">
          Mark fixed
        </button>
      </div>
    `;
    rejectedList.appendChild(li);
  }

  rejectedList.querySelectorAll('[data-mark-fixed]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const prev = button.textContent;
      button.textContent = 'Saving…';
      try {
        const response = await sendMessage({
          type: 'MARK_BID_FIXED',
          jobId: button.dataset.markFixed,
        });
        if (!response?.ok) {
          alert(response?.error || 'Failed to mark fixed.');
          return;
        }
        await loadRejected();
      } catch (err) {
        alert(err.message || 'Failed to mark fixed.');
      } finally {
        button.disabled = false;
        button.textContent = prev;
      }
    });
  });
}

async function loadRejected() {
  rejectedLoading = true;
  renderRejected();
  try {
    const response = await sendMessage({ type: 'GET_REJECTED_BIDS' });
    if (!response?.ok) {
      rejectedJobs = [];
      if (rejectedHint) {
        rejectedHint.textContent = response?.error || 'Failed to load rejected bids.';
      }
    } else {
      rejectedJobs = Array.isArray(response.results) ? response.results : [];
    }
  } catch (err) {
    rejectedJobs = [];
    if (rejectedHint) {
      rejectedHint.textContent = err.message || 'Failed to load rejected bids.';
    }
  } finally {
    rejectedLoading = false;
    renderRejected();
  }
}

function renderDashboard() {
  const auth = dashboardState.auth;
  if (!auth) {
    loginView.classList.remove('hidden');
    workspaceView.classList.add('hidden');
    return;
  }

  loginView.classList.add('hidden');
  workspaceView.classList.remove('hidden');
  profileNameEl.textContent = auth.displayName;
  roleBadgeEl.textContent = auth.role;
  roleBadgeEl.className = `role-badge ${auth.role}`;
  renderQueue();
  if (workspacePage === 'rejected') {
    renderRejected();
  } else {
    loadRejected().catch(() => {});
  }
  refreshApplySession().catch(() => {});
  refreshBridgeBadge().catch(() => {});
}

async function loadDashboard({ preferCache = true, force = false } = {}) {
  const response = await sendMessage({
    type: 'GET_DASHBOARD',
    preferCache: force ? false : preferCache,
  });
  if (response?.auth) {
    dashboardState = response;
    queueLoading = false;
    renderDashboard();
    return;
  }
  dashboardState = { auth: null, pools: [] };
  queueLoading = false;
  renderDashboard();
}

async function runAnalyze() {
  let tabId = resolveFinishTabId() || currentTabId;
  const job = currentTabState?.applyJob;
  if (!tabId && activeJobId) {
    const reopen = await sendMessage({ type: 'REOPEN_APPLY_TAB', jobId: activeJobId });
    tabId = reopen?.tabId || null;
  }
  if (!tabId) {
    alert('Open a job tab first.');
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing…';
  screeningPanel?.classList.remove('hidden');
  if (analyzeStatus) {
    analyzeStatus.textContent = 'Reading full page (no length limit)…';
    analyzeStatus.classList.remove('hidden');
  }

  try {
    const response = await sendMessage({
      type: 'ANALYZE_JOB_TAB',
      tabId,
      jobId: job?.id || job?.athensJobId || activeJobId,
      companyName: job?.companyName,
      jobTitle: job?.title,
      applyUrl: job?.jdUrl,
    });

    if (!response?.ok) {
      persistedAnalysis = {
        jdAnalyzed: false,
        flags: { remote: null, clearance: null },
        error: response?.error || 'Analyze failed',
      };
      renderAnalysis(persistedAnalysis);
      alert(response?.error || 'Analyze failed. Is Athens-server running?');
      return;
    }

    const priorRecommend = persistedAnalysis?.recommend || null;
    persistedAnalysis = response.analysis || {
      jdAnalyzed: response.jdAnalyzed,
      flags: response.flags || { remote: null, clearance: null },
      summary: response.summary,
      formAnswers: response.formAnswers || response.page?.formAnswers || [],
      formCount: response.formCount,
      charCount: response.charCount,
      error:
        response.mode === 'heuristic'
          ? 'Analyzed with local heuristics (no LLM key or LLM unavailable)'
          : response.flagsError || response.pageError || null,
    };
    if (!persistedAnalysis.recommend && priorRecommend) {
      persistedAnalysis.recommend = priorRecommend;
    }
    renderAnalysis(persistedAnalysis);
  } catch (err) {
    alert(err.message || 'Analyze failed.');
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze';
  }
}

startRecordingBtn?.addEventListener('click', () => {
  showRecordingInstructions();
});

analyzeBtn?.addEventListener('click', () => {
  runAnalyze().catch((err) => alert(err?.message || 'Analyze failed.'));
});

async function runRecommendResume() {
  if (!persistedAnalysis?.jdAnalyzed) {
    alert('Analyze the job first (JD light green), then recommend a resume.');
    return;
  }

  let tabId = resolveFinishTabId() || currentTabId;
  const job = currentTabState?.applyJob;
  if (!tabId && activeJobId) {
    const reopen = await sendMessage({ type: 'REOPEN_APPLY_TAB', jobId: activeJobId });
    tabId = reopen?.tabId || null;
  }
  if (!tabId) {
    alert('Open a job tab first.');
    return;
  }

  if (recommendResumeBtn) {
    recommendResumeBtn.disabled = true;
    recommendResumeBtn.textContent = 'Recommending…';
  }
  if (recommendResumeWarning) {
    recommendResumeWarning.textContent = 'Matching Library resumes to this JD…';
    recommendResumeWarning.classList.remove('hidden');
  }

  try {
    const response = await sendMessage({
      type: 'RECOMMEND_RESUME',
      tabId,
      jobId: job?.id || job?.athensJobId || activeJobId,
    });

    if (!response?.ok) {
      renderRecommend({
        recommendedResume: null,
        useCustomizedResume: false,
        isJobDescription: false,
        warning: response?.error || 'Recommend resume failed.',
      });
      alert(response?.error || 'Recommend resume failed. Is Athens-server running?');
      return;
    }

    const recommend = response.recommend || {
      recommendedResume: response.result?.matchedCatalogKey || null,
      useCustomizedResume: Boolean(response.result?.useCustomizedResume),
      warning: response.result?.warning || null,
      reason: response.result?.reason || null,
      isJobDescription: Boolean(response.result?.isJobDescription),
    };

    persistedAnalysis = {
      ...(persistedAnalysis || {}),
      recommend,
    };
    renderRecommend(recommend);
  } catch (err) {
    alert(err.message || 'Recommend resume failed.');
  } finally {
    if (recommendResumeBtn) {
      recommendResumeBtn.disabled = !persistedAnalysis?.jdAnalyzed;
      recommendResumeBtn.textContent = 'Recommend resume';
    }
  }
}

recommendResumeBtn?.addEventListener('click', () => {
  runRecommendResume().catch((err) => alert(err?.message || 'Recommend resume failed.'));
});

openJobBtn?.addEventListener('click', () => {
  const url = currentTabState?.applyJob?.jdUrl;
  if (url) chrome.tabs.create({ url, active: true });
});

reopenJobBtn?.addEventListener('click', async () => {
  if (!activeJobId) return;
  reopenJobBtn.disabled = true;
  try {
    const res = await sendMessage({ type: 'REOPEN_APPLY_TAB', jobId: activeJobId });
    if (!res?.ok) alert(res?.error || 'Failed to reopen job.');
    await refreshApplySession();
  } catch (err) {
    alert(err?.message || 'Failed to reopen job.');
  } finally {
    reopenJobBtn.disabled = false;
  }
});

applyViewResumeBtn?.addEventListener('click', async () => {
  if (!applyResumeJobId) return;
  applyViewResumeBtn.disabled = true;
  try {
    const res = await sendMessage({ type: 'OPEN_JOB_RESUME', jobId: applyResumeJobId });
    if (!res?.ok) alert(res?.error || 'Failed to open résumé.');
  } catch (err) {
    alert(err?.message || 'Failed to open résumé.');
  } finally {
    applyViewResumeBtn.disabled = false;
  }
});

applyDownloadResumeBtn?.addEventListener('click', async () => {
  if (!applyResumeJobId) return;
  applyDownloadResumeBtn.disabled = true;
  const prev = applyDownloadResumeBtn.textContent;
  applyDownloadResumeBtn.textContent = 'Downloading…';
  try {
    const res = await sendMessage({ type: 'DOWNLOAD_JOB_RESUME', jobId: applyResumeJobId });
    if (!res?.ok) alert(res?.error || 'Failed to download résumé.');
  } catch (err) {
    alert(err?.message || 'Failed to download résumé.');
  } finally {
    applyDownloadResumeBtn.disabled = false;
    applyDownloadResumeBtn.textContent = prev;
  }
});

applyCopyResumeNameBtn?.addEventListener('click', async () => {
  const name = applyResumeFileName?.textContent?.trim() || '';
  if (!name) return;
  const ok = await copyTextToClipboard(name);
  const prev = applyCopyResumeNameBtn.textContent;
  applyCopyResumeNameBtn.textContent = ok ? 'Copied' : 'Failed';
  setTimeout(() => {
    applyCopyResumeNameBtn.textContent = prev;
  }, 1200);
});

submitRecordingBtn?.addEventListener('click', () => {
  finishApply(resolveFinishTabId(), 'submit').catch((err) =>
    alert(err?.message || 'Failed to submit.'),
  );
});

skipRecordingBtn?.addEventListener('click', () => {
  finishApply(resolveFinishTabId(), 'skip').catch((err) =>
    alert(err?.message || 'Failed to skip.'),
  );
});

refreshQueueBtn?.addEventListener('click', () => {
  loadDashboard({ force: true }).catch(() => {});
});

refreshRejectedBtn?.addEventListener('click', () => {
  loadRejected().catch(() => {});
});

downloadResumesZipBtn?.addEventListener('click', async () => {
  downloadResumesZipBtn.disabled = true;
  const prev = downloadResumesZipBtn.textContent;
  downloadResumesZipBtn.textContent = 'Zipping…';
  try {
    const jobs = getQueueJobs();
    const jobIds = jobs.map((j) => j.athensJobId || j.id).filter(Boolean);
    const response = await sendMessage({
      type: 'DOWNLOAD_RESUMES_ZIP',
      jobIds,
    });
    if (!response?.ok) alert(response?.error || 'Failed to download zip.');
  } catch (err) {
    alert(err.message || 'Failed to download zip.');
  } finally {
    downloadResumesZipBtn.disabled = false;
    downloadResumesZipBtn.textContent = prev;
  }
});

workspaceTabs?.querySelectorAll('.workspace-tab').forEach((btn) => {
  btn.addEventListener('click', () => setWorkspacePage(btn.dataset.tab));
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showLoginError('');

  const applierName = applierNameInput?.value?.trim() || '';
  const password = passwordInput?.value || '';
  if (!password) {
    showLoginError('Vendor access password is required.');
    return;
  }

  signInBtn.disabled = true;
  const prevLabel = signInBtn.textContent;
  signInBtn.textContent = 'Signing in…';

  const response = await sendMessage({
    type: 'SIGN_IN',
    username: applierName,
    password,
    applierName,
    apiUrl: ATHENS_API_URL,
  });

  signInBtn.disabled = false;
  signInBtn.textContent = prevLabel || 'Sign in';

  if (!response?.ok) {
    showLoginError(response?.error || 'Sign in failed.');
    return;
  }

  // Unlock workspace immediately; queue loads in background.
  dashboardState = {
    auth: response.auth,
    pools: [
      {
        id: 'athens-bid-ready',
        name: 'Bid Ready',
        status: 'active',
        jobs: [],
      },
    ],
    athensError: null,
  };
  queueLoading = true;
  renderDashboard();
  loadDashboard({ preferCache: false }).catch(() => {});
});

signOutBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'SIGN_OUT' });
  dashboardState = { auth: null, pools: [] };
  persistedAnalysis = null;
  activeJobId = null;
  renderDashboard();
});

formatOptions.forEach((button) => {
  button.addEventListener('click', () => {
    setSelectedVideoFormat(button.dataset.format);
  });
});

let dashboardReloadTimer = null;
function scheduleDashboardReload() {
  if (dashboardReloadTimer) clearTimeout(dashboardReloadTimer);
  dashboardReloadTimer = setTimeout(() => {
    dashboardReloadTimer = null;
    loadDashboard({ preferCache: true }).catch(() => {});
  }, 400);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (
    changes.bidReadyCache ||
    changes.activeAppliesByJobId ||
    changes.bidReadyFinishedJobs ||
    changes.bidMonitorSessions ||
    changes.pendingApplyTabs
  ) {
    if (
      changes.bidReadyCache ||
      changes.activeAppliesByJobId ||
      changes.bidReadyFinishedJobs
    ) {
      scheduleDashboardReload();
    }
    refreshApplySession().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'APPLY_SESSION_UPDATED' || message.type === 'QUEUE_ENRICHED') {
    if (message.type === 'QUEUE_ENRICHED') {
      scheduleDashboardReload();
    }
    refreshApplySession().catch(() => {});
    return;
  }

  if (message.type === 'PANEL_HIGHLIGHT_START' || message.type === 'PANEL_HIGHLIGHT_FINISH') {
    refreshApplySession()
      .then(() => {
        applySessionView.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        finishFooter?.classList.remove('hidden');
        submitRecordingBtn?.classList.add('pulse');
        setTimeout(() => submitRecordingBtn?.classList.remove('pulse'), 2000);
      })
      .catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(() => {
  refreshApplySession().catch(() => {});
});

chrome.windows.onFocusChanged.addListener(() => {
  refreshApplySession().catch(() => {});
});

(async function init() {
  const {
    videoFormat = 'webm',
    athensSettings,
    bidMonitorCompletedDay,
  } = await chrome.storage.local.get([
    'videoFormat',
    'athensSettings',
    'bidMonitorCompletedDay',
  ]);
  setSelectedVideoFormat(videoFormat);

  const todayKey = new Date().toISOString().slice(0, 10);
  if (bidMonitorCompletedDay?.dayKey === todayKey) {
    completedTodayCount = Number(bidMonitorCompletedDay.count) || 0;
  } else {
    completedTodayCount = 0;
    await chrome.storage.local.set({
      bidMonitorCompletedDay: { dayKey: todayKey, count: 0 },
    });
  }
  updateCompletedPill();

  if (applierNameInput && athensSettings?.applierName) {
    applierNameInput.value = athensSettings.applierName;
  }
  if (usernameInput && athensSettings?.applierName && !usernameInput.value) {
    usernameInput.value = athensSettings.applierName;
  }

  const ui = await sendMessage({ type: 'GET_UI_STATE' }).catch(() => null);
  if (ui?.ok && ui.auth) {
    dashboardState = {
      auth: ui.auth,
      pools: ui.pools || [],
      athensError: ui.athensError || null,
      fromCache: ui.fromCache,
      refreshing: ui.refreshing,
    };
    if (ui.activeApply?.analysis) persistedAnalysis = ui.activeApply.analysis;
    recordingSessions = ui.recordingSessions || [];
    queueLoading = Boolean(ui.refreshing && !(ui.pools?.[0]?.jobs?.length));
    renderDashboard();
  } else {
    await loadDashboard({ preferCache: true });
  }

  setInterval(() => refreshApplySession().catch(() => {}), 12000);
  setInterval(() => refreshBridgeBadge().catch(() => {}), 15000);
})();
