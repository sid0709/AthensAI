const VideoFormat = (() => {
  const MIME_CANDIDATES = {
    webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
    mp4: ['video/mp4;codecs=avc1', 'video/mp4;codecs=h264', 'video/mp4'],
  };

  function normalizePreference(value) {
    return value === 'mp4' ? 'mp4' : 'webm';
  }

  function extensionForMimeType(mimeType) {
    const mime = String(mimeType ?? '').toLowerCase();
    if (mime.includes('mp4')) return 'mp4';
    return 'webm';
  }

  function pickMimeType(preferredFormat) {
    const preference = normalizePreference(preferredFormat);
    const fallback = preference === 'mp4' ? 'webm' : 'mp4';
    const order = [preference, fallback];

    if (typeof MediaRecorder === 'undefined') {
      return {
        mimeType: preference === 'mp4' ? 'video/mp4' : 'video/webm',
        format: preference,
        fallbackUsed: false,
      };
    }

    for (const format of order) {
      const mimeType = MIME_CANDIDATES[format].find((type) => MediaRecorder.isTypeSupported(type));
      if (mimeType) {
        return {
          mimeType,
          format,
          fallbackUsed: format !== preference,
        };
      }
    }

    return {
      mimeType: 'video/webm',
      format: 'webm',
      fallbackUsed: preference !== 'webm',
    };
  }

  return {
    normalizePreference,
    extensionForMimeType,
    pickMimeType,
  };
})();
