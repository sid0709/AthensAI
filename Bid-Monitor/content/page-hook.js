(function () {
  if (window.__bidMonitorPageHook) return;
  window.__bidMonitorPageHook = true;

  let resumeSetFolder = '';
  let expectedResumeName = '';
  let isRecording = false;
  const BID_ORIGINAL_NAME_PROP = '__bidOriginalName';

  window.addEventListener('bid-monitor-session', (event) => {
    const detail = event.detail || {};
    resumeSetFolder = String(detail.resumeSetFolder || '').trim();
    expectedResumeName = String(detail.expectedResumeName || '').trim();
    isRecording = !!detail.isRecording;
  });

  function getExtension(fileName) {
    const dot = fileName.lastIndexOf('.');
    return dot >= 0 ? fileName.slice(dot) : '';
  }

  function sanitizeForFileName(value) {
    return String(value || '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 60);
  }

  function buildSubmittedFileName(originalName, folder) {
    const ext = getExtension(originalName) || '.pdf';
    const safe = sanitizeForFileName(folder);
    if (!safe) return originalName;
    return `${safe}${ext}`;
  }

  function resumeBasename(name) {
    const s = String(name || '').trim();
    if (!s) return '';
    const parts = s.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || '';
  }

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
    if (file.name === newName && !originalName) return file;
    const next = new File([file], newName, {
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified ?? Date.now(),
    });
    return stampOriginalName(next, originalName || getStampedOriginal(file) || file.name);
  }

  function shouldRename() {
    return isRecording && resumeSetFolder.length > 0;
  }

  function maybeRenameFile(file) {
    if (!shouldRename() || !isFileValue(file)) return file;
    const original = getStampedOriginal(file) || file.name;
    const newName = buildSubmittedFileName(original, resumeSetFolder);
    return renameFile(file, newName, original);
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

  function emitAuditForFile(file, source) {
    const originalName = resumeBasename(getStampedOriginal(file) || file.name);
    const cleanedName = resumeBasename(file.name);
    const expected = resumeBasename(expectedResumeName);
    const renamed = cleanedName !== originalName;
    const mismatch = Boolean(expected && originalName && originalName !== expected);

    notifyResumeSelected({
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
    });

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
      const renamed = maybeRenameFile(file);
      renamedFiles.push(renamed);
      emitAuditForFile(renamed, source);
    }
    return renamedFiles;
  }

  function handleFileInputEvent(event) {
    try {
      const input = event.target;
      if (!shouldRename() || !(input instanceof HTMLInputElement) || input.type !== 'file') return;
      if (!input.files?.length) return;

      const originalFiles = Array.from(input.files);
      const dedupeKey = `${input.id}|${input.name}|${originalFiles.map((f) => `${f.name}:${f.size}`).join(',')}`;
      if (handleFileInputEvent.lastKey === dedupeKey) return;
      handleFileInputEvent.lastKey = dedupeKey;

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

  function patchFormData() {
    if (typeof FormData === 'undefined' || FormData.prototype.__bidMonitorPatched) return;
    const originalAppend = FormData.prototype.append;
    const originalSet = FormData.prototype.set;

    function wrap(method) {
      return function (name, value, fileName) {
        if (shouldRename() && isFileValue(value)) {
          const renamed = maybeRenameFile(value);
          emitAuditForFile(renamed, 'formdata');
          return method.call(this, name, renamed, renamed.name);
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
  patchFormData();
  patchFetch();
})();
