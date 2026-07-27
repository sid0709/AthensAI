// src/config.ts
var SENDER = "li-job-scraper";
var API_ENDPOINT = "https://sid.remotepairnet.net/api/expose/jobs";
var CHECK_API_ENDPOINT = "https://sid.remotepairnet.net/api/expose/jobs/check";

// src/api.ts
function buildHeaders() {
  const headers = {
    "Content-Type": "application/json"
  };
  if (API_ENDPOINT.includes("ngrok")) {
    headers["ngrok-skip-browser-warning"] = "true";
  }
  return headers;
}
function formatJobId(linkedInJobId) {
  const id = linkedInJobId?.trim();
  if (!id || !/^\d+$/.test(id)) {
    return null;
  }
  return `linkedin-${id}`;
}
async function checkJobExists(jobID) {
  const response = await fetch(CHECK_API_ENDPOINT, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ jobID })
  });
  try {
    return await response.json();
  } catch {
    return null;
  }
}
async function sendJobToScrapeApi(payload) {
  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload)
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body
  };
}

// src/sidebar.ts
var emptyState = document.getElementById("empty-state");
var jobPanel = document.getElementById("job-panel");
var jobTitleEl = document.getElementById("job-title");
var jobCompanyEl = document.getElementById("job-company");
var jobPostedAtEl = document.getElementById("job-posted-at");
var jobRecordedNotice = document.getElementById("job-recorded-notice");
var companyAvatarEl = document.getElementById("company-avatar");
var jobLinkEl = document.getElementById("job-link");
var jdTextEl = document.getElementById("jd-text");
var btnSend = document.getElementById("btn-send");
var toastEl = document.getElementById("toast");
var currentJob = null;
var submitting = false;
var checkingJob = false;
var jobExistsOnServer = false;
var toastTimer = null;
var currentJobKey = "";
var sentJobKeys = /* @__PURE__ */ new Set();
var jobExistsCache = /* @__PURE__ */ new Map();
var checkInFlight = /* @__PURE__ */ new Map();
function isExtensionContextValid() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}
function jobKey(job) {
  return job.linkedInJobId?.trim() || job.linkedInJobUrl?.trim() || job.jobUrl?.trim() || `${job.jobTitle}|${job.companyName}`;
}
function setJobLink(href) {
  if (!href) {
    jobLinkEl.classList.add("hidden");
    jobLinkEl.removeAttribute("href");
    return;
  }
  jobLinkEl.href = href;
  jobLinkEl.textContent = href;
  jobLinkEl.title = href;
  jobLinkEl.classList.remove("hidden");
}
function setCompanyAvatar(logoUrl, companyName) {
  const initial = (companyName?.trim()?.charAt(0) || "?").toUpperCase();
  if (logoUrl && /^https?:\/\//.test(logoUrl)) {
    companyAvatarEl.textContent = "";
    companyAvatarEl.style.backgroundImage = `url("${logoUrl.replace(/"/g, "%22")}")`;
    companyAvatarEl.classList.add("has-logo");
  } else {
    companyAvatarEl.style.backgroundImage = "";
    companyAvatarEl.classList.remove("has-logo");
    companyAvatarEl.textContent = initial;
  }
}
function showToast(message, kind) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden", "success", "error");
  toastEl.classList.add(kind);
  toastEl.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 4e3);
}
function showError(message) {
  showToast(message, "error");
}
function isJobAlreadyHandled() {
  return jobExistsOnServer || currentJobKey !== "" && sentJobKeys.has(currentJobKey);
}
function canSend() {
  if (!currentJob) return false;
  if (submitting || checkingJob) return false;
  if (isJobAlreadyHandled()) return false;
  const description = currentJob.jobDescription?.trim() || "";
  if (description.length === 0) return false;
  const jobLink = currentJob.realJobUrl?.trim() || currentJob.linkedInJobUrl?.trim() || "";
  if (!/^https?:\/\//.test(jobLink)) return false;
  return true;
}
function updateRecordedNotice() {
  if (checkingJob) {
    jobRecordedNotice.textContent = "Checking if this job is already recorded\u2026";
    jobRecordedNotice.className = "job-recorded-notice is-checking";
    jobRecordedNotice.classList.remove("hidden");
    return;
  }
  if (jobExistsOnServer || currentJobKey && sentJobKeys.has(currentJobKey)) {
    jobRecordedNotice.textContent = "This job is already recorded on the server.";
    jobRecordedNotice.className = "job-recorded-notice is-recorded";
    jobRecordedNotice.classList.remove("hidden");
    return;
  }
  jobRecordedNotice.textContent = "";
  jobRecordedNotice.classList.add("hidden");
}
function updateSendButton() {
  updateRecordedNotice();
  if (submitting) {
    btnSend.disabled = true;
    btnSend.textContent = "Sending\u2026";
    return;
  }
  if (checkingJob) {
    btnSend.disabled = true;
    btnSend.textContent = "Checking\u2026";
    return;
  }
  if (isJobAlreadyHandled()) {
    btnSend.disabled = true;
    btnSend.textContent = "Already recorded";
    return;
  }
  btnSend.disabled = !canSend();
  btnSend.textContent = "Scrape";
}
function render() {
  if (!currentJob) {
    emptyState.classList.remove("hidden");
    jobPanel.classList.add("hidden");
    return;
  }
  emptyState.classList.add("hidden");
  jobPanel.classList.remove("hidden");
  jobTitleEl.textContent = currentJob.jobTitle || "Untitled position";
  jobCompanyEl.textContent = currentJob.companyName || "Unknown company";
  if (currentJob.postedAt) {
    jobPostedAtEl.textContent = currentJob.postedAt;
    jobPostedAtEl.classList.remove("hidden");
  } else {
    jobPostedAtEl.textContent = "";
    jobPostedAtEl.classList.add("hidden");
  }
  setCompanyAvatar(currentJob.companyLogoUrl, currentJob.companyName || "");
  setJobLink(currentJob.realJobUrl?.trim() || currentJob.linkedInJobUrl?.trim());
  jdTextEl.value = currentJob.jobDescription || "";
  updateSendButton();
}
async function refreshJobRecordedStatus(job) {
  const jobID = formatJobId(job.linkedInJobId);
  if (!jobID) {
    jobExistsOnServer = false;
    checkingJob = false;
    updateSendButton();
    return;
  }
  if (jobExistsCache.has(jobID)) {
    jobExistsOnServer = jobExistsCache.get(jobID);
    if (jobExistsOnServer && currentJobKey) {
      sentJobKeys.add(currentJobKey);
    }
    checkingJob = false;
    updateSendButton();
    return;
  }
  const inFlight = checkInFlight.get(jobID);
  if (inFlight) {
    checkingJob = true;
    updateSendButton();
    try {
      const exists = await inFlight;
      if (formatJobId(currentJob?.linkedInJobId) !== jobID) {
        return;
      }
      jobExistsOnServer = exists;
      if (exists && currentJobKey) {
        sentJobKeys.add(currentJobKey);
      }
    } finally {
      if (formatJobId(currentJob?.linkedInJobId) === jobID) {
        checkingJob = false;
        updateSendButton();
      }
    }
    return;
  }
  checkingJob = true;
  updateSendButton();
  const request = checkJobExists(jobID).then((result) => {
    const exists = result?.success === true && result.exists === true;
    jobExistsCache.set(jobID, exists);
    return exists;
  }).catch(() => {
    jobExistsCache.set(jobID, false);
    return false;
  });
  checkInFlight.set(jobID, request);
  try {
    const exists = await request;
    if (formatJobId(currentJob?.linkedInJobId) !== jobID) {
      return;
    }
    jobExistsOnServer = exists;
    if (exists && currentJobKey) {
      sentJobKeys.add(currentJobKey);
    }
  } finally {
    checkInFlight.delete(jobID);
    if (formatJobId(currentJob?.linkedInJobId) === jobID) {
      checkingJob = false;
      updateSendButton();
    }
  }
}
function setJob(job) {
  const nextKey = jobKey(job);
  const sameJob = nextKey === currentJobKey;
  if (!sameJob) {
    currentJobKey = nextKey;
    jobExistsOnServer = false;
  }
  currentJob = job;
  render();
  if (!sameJob) {
    void refreshJobRecordedStatus(job);
  } else {
    const jobID = formatJobId(job.linkedInJobId);
    if (jobID && jobExistsCache.has(jobID)) {
      jobExistsOnServer = jobExistsCache.get(jobID);
      updateSendButton();
    }
  }
  try {
    chrome.runtime.sendMessage({ type: "OPEN_SIDEBAR" }).catch(() => {
    });
  } catch {
  }
}
function setupJobListener() {
  if (!isExtensionContextValid()) return;
  try {
    chrome.runtime.onMessage.addListener((rawMessage) => {
      const message = rawMessage;
      if ((message?.type === "JOB_DETECTED" || message?.type === "EXTRACT_JOB") && message.job) {
        setJob(message.job);
      }
    });
  } catch {
  }
}
async function sendToApi() {
  if (!currentJob || submitting || checkingJob) return;
  if (isJobAlreadyHandled()) return;
  const jobLink = currentJob.realJobUrl?.trim() || currentJob.linkedInJobUrl?.trim() || "";
  const description = currentJob.jobDescription?.trim() || "";
  const jobID = formatJobId(currentJob.linkedInJobId);
  if (!description) {
    showError("No job description to send yet.");
    return;
  }
  if (!/^https?:\/\//.test(jobLink)) {
    showError("Job link is missing \u2014 cannot send.");
    return;
  }
  const payload = {
    sender: SENDER,
    companyName: currentJob.companyName || "",
    companyIcon: currentJob.companyLogoUrl || void 0,
    jobTitle: currentJob.jobTitle || "",
    jobDescription: description,
    jobLink,
    source: "linkedin",
    postedAt: currentJob.postedAt || void 0,
    ...jobID ? { jobID } : {}
  };
  submitting = true;
  updateSendButton();
  try {
    const { ok, status, statusText, body } = await sendJobToScrapeApi(payload);
    if (ok && body?.success !== false) {
      if (currentJobKey) sentJobKeys.add(currentJobKey);
      jobExistsOnServer = true;
      if (jobID) {
        jobExistsCache.set(jobID, true);
      }
      if (body?.duplicate) {
        showToast("Already in catalog \u2014 duplicate detected.", "success");
      } else if (body?.created) {
        showToast("Sent to server.", "success");
      } else {
        showToast("Server accepted the request.", "success");
      }
    } else {
      const message = body?.error || `Server responded with ${status} ${statusText}`;
      showError(message);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown network error";
    showError(`Network error: ${reason}`);
  } finally {
    submitting = false;
    updateSendButton();
  }
}
function setupSendButton() {
  btnSend.addEventListener("click", () => {
    void sendToApi();
  });
}
setupSendButton();
setupJobListener();
render();
//# sourceMappingURL=sidebar.js.map
