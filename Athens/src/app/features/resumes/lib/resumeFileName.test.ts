import assert from "node:assert/strict";
import test from "node:test";

import { resumeDownloadFileName } from "./resumeFileName";

test("Word downloads keep the full name, including spaces", () => {
  assert.equal(resumeDownloadFileName("John Doe"), "John Doe.docx");
  assert.equal(resumeDownloadFileName("  Julian Bernardino  "), "Julian Bernardino.docx");
  assert.equal(resumeDownloadFileName(""), "resume.docx");
});
