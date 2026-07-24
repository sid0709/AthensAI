(function () {
  if (window.__bidMonitorPageHook) return;
  const ResumeFileTracking = globalThis.BidResumeFileTracking;
  if (!ResumeFileTracking?.createTracker) {
    console.warn('Bid Monitor: resume filename tracker is unavailable');
    return;
  }
  window.__bidMonitorPageHook = true;

  let resumeSetFolder = '';
  let expectedResumeName = '';
  let activeSessionId = '';
  let trackingSessionKey = '';
  let isRecording = false;
  const BID_ORIGINAL_NAME_PROP = '__bidOriginalName';
  const fileTracker = ResumeFileTracking.createTracker();

  window.addEventListener('bid-monitor-session', (event) => {
    const detail = event.detail || {};
    const nextFolder = String(detail.resumeSetFolder || '').trim();
    const nextExpectedName = String(detail.expectedResumeName || '').trim();
    const nextSessionId = String(detail.sessionId || '').trim();
    const nextIsRecording = !!detail.isRecording;
    const nextTrackingKey = nextIsRecording
      ? nextSessionId || `${nextExpectedName}|${nextFolder}`
      : '';

    if (nextTrackingKey !== trackingSessionKey) {
      fileTracker.reset(nextTrackingKey);
      trackingSessionKey = nextTrackingKey;
    }

    resumeSetFolder = nextFolder;
    expectedResumeName = nextExpectedName;
    activeSessionId = nextSessionId;
    isRecording = nextIsRecording;
  });

  const { buildSubmittedFileName, resumeBasename } = ResumeFileTracking;

  function isFileValue(value) {
    if (!value || typeof value !== 'object') return false;
    if (value instanceof File) return true;
    // Require a real Blob so duck-typed lookalikes cannot enter FormData's Blob overload.
    if (!(value instanceof Blob)) return false;
    return (
      typeof value.name === 'string' &&
      typeof value.size === 'number' &&
      typeof value.arrayBuffer === 'function'
    );
  }

  function stampOriginalName(file, originalName) {
    try {
      Object.defineProperty(file, BID_ORIGINAL_NAME_PROP, {
        value: originalName,
        enumerable: false,
        configurable: true,
      });
    } catch {
      file[BID_ORIGINAL_NAME_PROP] = originalName;
    }
    return file;
  }

  function getStampedOriginal(file) {
    const v = file?.[BID_ORIGINAL_NAME_PROP];
    return typeof v === 'string' && v.length ? v : null;
  }

  function renameFile(file, newName, originalName) {
    if (file.name === newName) {
      return stampOriginalName(file, originalName || getStampedOriginal(file) || file.name);
    }
    const next = new File([file], newName, {
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified ?? Date.now(),
    });
    return stampOriginalName(next, originalName || getStampedOriginal(file) || file.name);
  }

  function shouldRename() {
    return isRecording && (expectedResumeName.length > 0 || resumeSetFolder.length > 0);
  }

  function prepareFile(file) {
    if (!shouldRename() || !isFileValue(file)) return { file, originalName: file?.name || '' };
    const provisionalName = buildSubmittedFileName(
      file.name,
      expectedResumeName,
      resumeSetFolder,
    );
    const originalName = fileTracker.resolveOriginal(
      file,
      provisionalName,
      getStampedOriginal(file),
    );
    const submittedName = buildSubmittedFileName(
      originalName,
      expectedResumeName,
      resumeSetFolder,
    );
    return {
      file: renameFile(file, submittedName, originalName),
      originalName,
      submittedName,
    };
  }

  function replaceInputFiles(input, files) {
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return false;

    const dt = new DataTransfer();
    for (const file of files) {
      dt.items.add(file);
    }

    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (descriptor?.set) {
      descriptor.set.call(input, dt.files);
    } else {
      input.files = dt.files;
    }

    return true;
  }

  function notifyResumeSelected(payload) {
    window.dispatchEvent(new CustomEvent('bid-monitor-resume', { detail: payload }));
  }

  function notifyToast(message) {
    window.dispatchEvent(new CustomEvent('bid-monitor-toast', { detail: { message } }));
  }

  function emitAuditForFile(file, source, resolvedOriginalName, submittedName) {
    const originalName = resumeBasename(
      resolvedOriginalName || getStampedOriginal(file) || file.name,
    );
    const cleanedName = resumeBasename(file.name);
    const expected = resumeBasename(submittedName || cleanedName);
    const renamed = cleanedName !== originalName;
    const mismatch = Boolean(expected && originalName && originalName !== expected);
    const payload = {
      sessionId: activeSessionId || null,
      originalFileName: originalName,
      originalName,
      submittedFileName: cleanedName,
      cleanedName,
      expectedName: expected || null,
      renamed,
      mismatch,
      fileName: originalName,
      fileSize: file.size,
      lastModified: file.lastModified,
      mimeType: file.type || null,
      pageUrl: location.href,
      pageTitle: document.title,
      source,
    };
    payload.auditKey = fileTracker.buildAuditKey(payload);
    if (!fileTracker.shouldEmit(payload)) return;

    notifyResumeSelected(payload);

    if (mismatch) {
      notifyToast(`Résumé name mismatch: got “${originalName}”, expected “${expected}”`);
    } else if (renamed) {
      notifyToast(`Uploading as ${cleanedName}`);
    }
  }

  function processFiles(fileList, source) {
    if (!shouldRename() || !fileList?.length) return null;
    const originalFiles = Array.from(fileList);
    const renamedFiles = [];
    for (const file of originalFiles) {
      const prepared = prepareFile(file);
      renamedFiles.push(prepared.file);
      emitAuditForFile(
        prepared.file,
        source,
        prepared.originalName,
        prepared.submittedName,
      );
    }
    return renamedFiles;
  }

  function handleFileInputEvent(event) {
    try {
      const input = event.target;
      if (!shouldRename() || !(input instanceof HTMLInputElement) || input.type !== 'file') return;
      if (!input.files?.length) return;

      const renamedFiles = processFiles(input.files, 'file-input');
      if (renamedFiles) replaceInputFiles(input, renamedFiles);
    } catch (err) {
      console.warn('Bid Monitor: resume rename failed', err);
    }
  }

  function handleDropEvent(event) {
    try {
      if (!shouldRename() || !event.dataTransfer?.files?.length) return;
      const files = Array.from(event.dataTransfer.files).filter((f) =>
        /\.(pdf|docx)$/i.test(f.name),
      );
      if (!files.length) return;

      const renamed = processFiles(files, 'drag-drop');
      if (!renamed) return;

      // Best-effort: if drop target is a file input, rewrite its files.
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const input = path.find(
        (n) => n instanceof HTMLInputElement && n.type === 'file',
      );
      if (input) replaceInputFiles(input, renamed);

      try {
        const dt = new DataTransfer();
        for (const f of renamed) dt.items.add(f);
        Object.defineProperty(event, 'dataTransfer', {
          configurable: true,
          value: dt,
        });
      } catch {
        /* some browsers block redefining dataTransfer */
      }
    } catch (err) {
      console.warn('Bid Monitor: drag-drop rename failed', err);
    }
  }

  function handleSubmitEvent(event) {
    try {
      if (!shouldRename()) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      for (const input of form.querySelectorAll('input[type="file"]')) {
        if (!input.files?.length) continue;
        const renamedFiles = processFiles(input.files, 'form-submit');
        if (renamedFiles) replaceInputFiles(input, renamedFiles);
      }
    } catch (err) {
      console.warn('Bid Monitor: submit-time resume audit failed', err);
    }
  }

  function patchFormData() {
    if (typeof FormData === 'undefined' || FormData.prototype.__bidMonitorPatched) return;
    const originalAppend = FormData.prototype.append;
    const originalSet = FormData.prototype.set;

    function wrap(method) {
      return function (name, value, fileName) {
        if (shouldRename() && isFileValue(value)) {
          const prepared = prepareFile(value);
          emitAuditForFile(
            prepared.file,
            'formdata',
            prepared.originalName,
            prepared.submittedName,
          );
          return method.call(this, name, prepared.file, prepared.file.name);
        }
        // 3-arg FormData.append/set requires param 2 to be a Blob.
        if (arguments.length >= 3 && value instanceof Blob) {
          return method.call(this, name, value, fileName);
        }
        return method.call(this, name, value);
      };
    }

    FormData.prototype.append = wrap(originalAppend);
    FormData.prototype.set = wrap(originalSet);
    FormData.prototype.__bidMonitorPatched = true;
  }

  function patchFetch() {
    if (typeof window.fetch !== 'function' || window.fetch.__bidMonitorPatched) return;
    const originalFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      try {
        if (shouldRename() && init?.body instanceof FormData) {
          // FormData already patched via append/set during construction.
        }
      } catch {
        /* ignore */
      }
      return originalFetch(input, init);
    };
    window.fetch.__bidMonitorPatched = true;
  }

  document.addEventListener('change', handleFileInputEvent, true);
  document.addEventListener('input', handleFileInputEvent, true);
  document.addEventListener('drop', handleDropEvent, true);
  document.addEventListener('submit', handleSubmitEvent, true);
  patchFormData();
  patchFetch();
})();
