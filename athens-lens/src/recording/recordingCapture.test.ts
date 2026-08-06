import { describe, expect, it } from "vitest";
import { fitRecordingFrame, recordingFileExtension } from "./recordingCapture";

describe("recordingCapture", () => {
  it("fits a wide viewport into 1024×768 without breaking aspect ratio", () => {
    expect(fitRecordingFrame(1920, 1080)).toEqual({ width: 1024, height: 576 });
  });

  it("does not upscale a small capture region", () => {
    expect(fitRecordingFrame(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("maps mime types to mp4 or webm extensions", () => {
    expect(recordingFileExtension("video/mp4;codecs=avc1.42E01E")).toBe("mp4");
    expect(recordingFileExtension("video/webm;codecs=vp9")).toBe("webm");
  });
});
