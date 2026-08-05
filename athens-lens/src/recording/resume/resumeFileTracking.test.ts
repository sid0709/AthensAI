import { describe, expect, it } from "vitest";
import { buildProfileResumeFileName } from "./canonicalResumeName";
import {
  buildRenameAudit,
  buildSubmittedFileName,
  createTracker,
  resumeAuditOutboxKey,
} from "./resumeFileTracking";

describe("Athens Lens resume rename tracking", () => {
  it("renames uploads to Profile Name.pdf or Profile Name.docx from the file type", () => {
    const expected = buildProfileResumeFileName("Eli Taylor", ".pdf");
    expect(expected).toBe("Eli Taylor.pdf");
    expect(buildSubmittedFileName("stack-backend.pdf", expected, "EliTaylor")).toBe("Eli Taylor.pdf");
    expect(buildSubmittedFileName("stack-backend.PDF", expected, "EliTaylor")).toBe("Eli Taylor.PDF");
    expect(buildSubmittedFileName("stack-backend.docx", expected, "EliTaylor")).toBe("Eli Taylor.docx");
    expect(buildSubmittedFileName("Oliver_Baltay.docx", expected, "EliTaylor")).toBe("Eli Taylor.docx");
  });

  it("remembers the original basename when an ATS copies the renamed File", () => {
    const tracker = createTracker();
    const expected = "Eli Taylor.pdf";
    tracker.reset("session-1");

    const selected = { name: "Backend.pdf", size: 42000, type: "application/pdf", lastModified: 100 };
    const original = tracker.resolveOriginal(selected, expected, null);
    expect(original).toBe("Backend.pdf");

    const firstAudit = {
      originalName: original,
      cleanedName: expected,
      fileSize: selected.size,
      mimeType: selected.type,
    };
    expect(tracker.shouldEmit(firstAudit)).toBe(true);

    const copied = { name: expected, size: 42000, type: "application/pdf", lastModified: 200 };
    expect(tracker.resolveOriginal(copied, expected, null)).toBe("Backend.pdf");
    expect(tracker.shouldEmit(firstAudit)).toBe(false);
  });

  it("stores original and cleaned names as an ordered audit pair", () => {
    const audit = buildRenameAudit({
      sessionId: "session-1",
      jobId: "job-1",
      originalName: "Oliver_Baltay.pdf",
      uploadedName: "Eli Taylor.pdf",
      expectedName: "Eli Taylor.pdf",
      fileSize: 100_540,
      mimeType: "application/pdf",
    });

    expect(audit.originalName).toBe("Oliver_Baltay.pdf");
    expect(audit.cleanedName).toBe("Eli Taylor.pdf");
    expect(audit.renamed).toBe(true);
    expect(audit.mismatch).toBe(false);
    expect(resumeAuditOutboxKey(audit)).toMatch(/^athensLensResumeAudit:session-1:/);
  });
});
