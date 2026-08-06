/**
 * Shared tab/desktop capture quality + MediaRecorder mime selection.
 * Caps at 1024×768 (never upscales); Chrome keeps source aspect ratio inside maxWidth/maxHeight.
 */

export const RECORDING_MAX_WIDTH = 1024;
export const RECORDING_MAX_HEIGHT = 768;
export const RECORDING_MAX_FRAME_RATE = 15;
/** Target encode rate for ~1024×768 @ 15fps review clips. */
export const RECORDING_VIDEO_BITS_PER_SECOND = 2_500_000;

export function recordingCaptureMandatory(
  chromeMediaSource: "tab" | "desktop",
  chromeMediaSourceId: string,
) {
  return {
    chromeMediaSource,
    chromeMediaSourceId,
    maxWidth: RECORDING_MAX_WIDTH,
    maxHeight: RECORDING_MAX_HEIGHT,
    maxFrameRate: RECORDING_MAX_FRAME_RATE,
  };
}

/** Prefer MP4/H.264; fall back to WebM only when MediaRecorder cannot encode MP4. */
export function pickRecordingMimeType(): string {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=avc1.4D001E",
    "video/mp4;codecs=avc1.64001F",
    "video/mp4;codecs=h264",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "video/mp4";
  }
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "video/mp4";
}

export function recordingFileExtension(mimeType: string): "mp4" | "webm" {
  return /mp4|avc1|h264/i.test(String(mimeType || "")) ? "mp4" : "webm";
}

/**
 * Scale native track size into the 1024×768 box without upscaling or changing aspect ratio.
 * Useful when a track reports settings larger than the capture cap.
 */
export function fitRecordingFrame(
  width: number,
  height: number,
  maxWidth = RECORDING_MAX_WIDTH,
  maxHeight = RECORDING_MAX_HEIGHT,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, maxWidth / w, maxHeight / h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}
