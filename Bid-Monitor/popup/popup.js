const loginView = document.getElementById('loginView');
const poolsView = document.getElementById('poolsView');
const jobsView = document.getElementById('jobsView');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('loginError');
const profileNameEl = document.getElementById('profileName');
const roleBadgeEl = document.getElementById('roleBadge');
const signOutBtn = document.getElementById('signOutBtn');
const poolList = document.getElementById('poolList');
const jobList = document.getElementById('jobList');
const jobsPoolTitle = document.getElementById('jobsPoolTitle');
const jobsPoolStatus = document.getElementById('jobsPoolStatus');
const backToPoolsBtn = document.getElementById('backToPoolsBtn');
const formatOptions = [...document.querySelectorAll('.format-option')];

let dashboardState = { auth: null, pools: [] };
let selectedPoolId = null;

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function showView(viewName) {
  loginView.classList.toggle('hidden', viewName !== 'login');
  poolsView.classList.toggle('hidden', viewName !== 'pools');
  jobsView.classList.toggle('hidden', viewName !== 'jobs');
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

function renderPools() {
  poolList.innerHTML = '';
  const pools = dashboardState.pools ?? [];

  if (!pools.length) {
    poolList.innerHTML = '<li class="empty">No job pools available.</li>';
    return;
  }

  for (const pool of pools) {
    const li = document.createElement('li');
    const statusClass = pool.status === 'active' ? 'status-active' : 'status-done';
    const appliedCount = pool.jobs.filter((job) => job.status === 'applied').length;
    li.innerHTML = `
      <strong>${pool.name}</strong>
      <span class="meta-line">${pool.jobs.length} jobs · ${appliedCount} applied</span>
      <span class="status-badge ${statusClass}">${pool.status}</span>
      <div class="item-actions">
        <button type="button" class="btn btn-secondary" data-open-pool="${pool.id}">View Jobs</button>
        ${dashboardState.auth?.role === 'owner'
          ? `<button type="button" class="btn btn-download" data-download-pool="${pool.id}">Download ZIP</button>`
          : ''}
      </div>
    `;
    poolList.appendChild(li);
  }

  poolList.querySelectorAll('[data-open-pool]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedPoolId = button.dataset.openPool;
      renderJobs(selectedPoolId);
      showView('jobs');
    });
  });

  poolList.querySelectorAll('[data-download-pool]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await sendMessage({ type: 'DOWNLOAD_POOL', poolId: button.dataset.downloadPool });
      } catch (err) {
        alert(err.message || 'Download failed.');
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderJobs(poolId) {
  const pool = dashboardState.pools.find((item) => item.id === poolId);
  if (!pool) return;

  jobsPoolTitle.textContent = pool.name;
  jobsPoolStatus.textContent = pool.status;
  jobsPoolStatus.className = `status-badge ${pool.status === 'active' ? 'status-active' : 'status-done'}`;

  jobList.innerHTML = '';
  const isBidder = dashboardState.auth?.role === 'bidder';
  const openJobs = pool.jobs.filter((job) => job.status !== 'applied');

  if (!pool.jobs.length) {
    jobList.innerHTML = '<li class="empty">No jobs in this pool.</li>';
    return;
  }

  if (isBidder && !openJobs.length) {
    jobList.innerHTML = '<li class="empty">All Bid Ready jobs are submitted.</li>';
    return;
  }

  for (const job of pool.jobs) {
    const li = document.createElement('li');
    const statusClass = job.status === 'applied' ? 'status-applied' : 'status-open';
    const statusLabel = job.status === 'applied' ? 'Applied' : 'Not applied';

    li.innerHTML = `
      <strong>${job.companyName}</strong>
      <span class="meta-line">${job.title}</span>
      <a class="jd-link meta-line" href="${job.jdUrl}" target="_blank" rel="noopener noreferrer">${job.jdUrl}</a>
      <span class="meta-line">Resume folder: <strong>${job.resumeFolderName}</strong></span>
      <span class="status-badge ${statusClass}">${statusLabel}</span>
      <div class="item-actions">
        ${isBidder && job.status !== 'applied'
          ? `<button type="button" class="btn btn-apply" data-apply-job="${job.id}">Apply</button>`
          : ''}
      </div>
    `;

    jobList.appendChild(li);
  }

  jobList.querySelectorAll('[data-apply-job]').forEach((button) => {
    button.addEventListener('click', () => {
      const jobId = button.dataset.applyJob;
      const job = pool.jobs.find((item) => item.id === jobId);
      if (!job) return;

      button.disabled = true;
      button.textContent = 'Opening…';

      chrome.tabs.create({ url: job.jdUrl, active: true }, (tab) => {
        if (chrome.runtime.lastError || !tab?.id) {
          alert(chrome.runtime.lastError?.message || 'Failed to open job application.');
          button.disabled = false;
          button.textContent = 'Apply';
          return;
        }

        const sendApply = (streamId) => {
          chrome.runtime.sendMessage(
            {
              type: 'APPLY_TO_JOB',
              poolId: pool.id,
              jobId: job.id,
              jobUrl: job.jdUrl,
              tabId: tab.id,
              streamId: streamId || null,
            },
            (response) => {
              if (chrome.runtime.lastError) {
                alert(chrome.runtime.lastError.message);
                button.disabled = false;
                button.textContent = 'Apply';
                return;
              }

              if (!response?.ok) {
                alert(response?.error || 'Failed to open job application.');
                button.disabled = false;
                button.textContent = 'Apply';
                return;
              }

              window.close();
            },
          );
        };

        if (!chrome.tabCapture?.getMediaStreamId) {
          sendApply(null);
          return;
        }

        chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
          sendApply(chrome.runtime.lastError ? null : streamId || null);
        });
      });
    });
  });
}

function renderDashboard() {
  const auth = dashboardState.auth;
  if (!auth) {
    showView('login');
    return;
  }

  profileNameEl.textContent = auth.displayName;
  roleBadgeEl.textContent = auth.role;
  roleBadgeEl.className = `role-badge ${auth.role}`;
  renderPools();

  if (selectedPoolId) {
    renderJobs(selectedPoolId);
    showView('jobs');
  } else {
    showView('pools');
  }
}

async function loadDashboard() {
  const response = await sendMessage({ type: 'GET_DASHBOARD' });
  if (response?.auth) {
    dashboardState = response;
    renderDashboard();
    return;
  }
  dashboardState = { auth: null, pools: [] };
  renderDashboard();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showLoginError('');

  const applierName = usernameInput.value.trim();
  const password = passwordInput?.value || '';
  if (!password) {
    showLoginError('Vendor access password is required.');
    return;
  }
  const response = await sendMessage({
    type: 'SIGN_IN',
    username: applierName,
    password,
    applierName,
    displayName: applierName,
  });

  if (!response?.ok) {
    showLoginError(response?.error || 'Sign in failed.');
    return;
  }

  usernameInput.value = '';
  await loadDashboard();
});

signOutBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'SIGN_OUT' });
  selectedPoolId = null;
  dashboardState = { auth: null, pools: [] };
  renderDashboard();
});

backToPoolsBtn.addEventListener('click', () => {
  selectedPoolId = null;
  showView('pools');
});

formatOptions.forEach((button) => {
  button.addEventListener('click', () => {
    setSelectedVideoFormat(button.dataset.format);
  });
});

(async function init() {
  const { videoFormat = 'webm' } = await chrome.storage.local.get('videoFormat');
  setSelectedVideoFormat(videoFormat);
  await loadDashboard();
})();
