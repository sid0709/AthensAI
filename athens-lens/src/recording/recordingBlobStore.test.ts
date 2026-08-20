import { afterEach, describe, expect, it } from "vitest";
import {
  deleteRecordingBlob,
  getRecordingBlob,
  putRecordingBlob,
  resetRecordingBlobStoreForTests,
} from "./recordingBlobStore";

describe("recordingBlobStore", () => {
  afterEach(() => {
    resetRecordingBlobStoreForTests();
  });

  it("returns a stored blob after the in-memory recorder is gone", async () => {
    const blob = new Blob(["clip"], { type: "video/webm" });
    await putRecordingBlob({
      sessionId: "lens-job-1",
      blob,
      mimeType: "video/webm",
      filename: "athens-lens-recording-1.webm",
      byteLength: blob.size,
    });

    const stored = await getRecordingBlob("lens-job-1");
    expect(stored).toMatchObject({
      sessionId: "lens-job-1",
      mimeType: "video/webm",
      filename: "athens-lens-recording-1.webm",
      byteLength: blob.size,
    });
    expect(stored?.blob.size).toBe(blob.size);
  });

  it("keeps the larger recording when a later write is smaller or empty", async () => {
    const large = new Blob(["12345678"], { type: "video/webm" });
    const small = new Blob(["x"], { type: "video/webm" });
    await putRecordingBlob({
      sessionId: "lens-job-2",
      blob: large,
      mimeType: "video/webm",
      filename: "large.webm",
      byteLength: large.size,
    });
    await putRecordingBlob({
      sessionId: "lens-job-2",
      blob: small,
      mimeType: "video/webm",
      filename: "small.webm",
      byteLength: small.size,
    });
    await putRecordingBlob({
      sessionId: "lens-job-2",
      blob: new Blob([]),
      mimeType: "video/webm",
      filename: "empty.webm",
      byteLength: 0,
    });

    const stored = await getRecordingBlob("lens-job-2");
    expect(stored?.filename).toBe("large.webm");
    expect(stored?.byteLength).toBe(large.size);
  });

  it("discards a stored recording", async () => {
    const blob = new Blob(["clip"], { type: "video/webm" });
    await putRecordingBlob({
      sessionId: "lens-job-3",
      blob,
      mimeType: "video/webm",
      filename: "clip.webm",
      byteLength: blob.size,
    });
    await deleteRecordingBlob("lens-job-3");
    await expect(getRecordingBlob("lens-job-3")).resolves.toBeNull();
  });
});
