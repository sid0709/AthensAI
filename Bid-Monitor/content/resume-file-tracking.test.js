const assert = require('assert');
const {
  buildRenameAudit,
  buildSubmittedFileName,
  createTracker,
  resumeAuditOutboxKey,
} = require('./resume-file-tracking.js');

function file(name, size, type, lastModified) {
  return { name, size, type, lastModified };
}

function testProfileUploadNameAndExtension() {
  const expected = 'Eli Taylor.pdf';
  assert.strictEqual(
    buildSubmittedFileName('Oliver_Baltay.pdf', expected, 'EliTaylor'),
    expected,
  );
  assert.strictEqual(
    buildSubmittedFileName('Oliver_Baltay.docx', expected, 'EliTaylor'),
    'Eli Taylor.docx',
  );
}

function testAshbyCopiedInputKeepsOriginal() {
  const tracker = createTracker();
  const expected = 'Eli Taylor.pdf';
  tracker.reset('session-1');

  const selected = file('Backend.pdf', 42000, 'application/pdf', 100);
  const original = tracker.resolveOriginal(selected, expected, null);
  assert.strictEqual(original, 'Backend.pdf');

  const firstAudit = {
    originalName: original,
    cleanedName: expected,
    fileSize: selected.size,
    mimeType: selected.type,
  };
  assert.strictEqual(tracker.shouldEmit(firstAudit), true);

  // Ashby creates another File for its required Resume field. The custom
  // property and lastModified value may be gone, but content metadata remains.
  const copied = file(expected, 42000, 'application/pdf', 200);
  assert.strictEqual(tracker.resolveOriginal(copied, expected, null), 'Backend.pdf');
  assert.strictEqual(tracker.shouldEmit(firstAudit), false);
}

function testDifferentSelectionReplacesOriginal() {
  const tracker = createTracker();
  const expected = 'Canonical.pdf';
  tracker.reset('session-1');
  assert.strictEqual(
    tracker.resolveOriginal(file('First.pdf', 10, 'application/pdf', 1), expected, null),
    'First.pdf',
  );
  assert.strictEqual(
    tracker.resolveOriginal(file('Second.pdf', 10, 'application/pdf', 2), expected, null),
    'Second.pdf',
  );
}

function testNewSessionClearsDedupe() {
  const tracker = createTracker();
  const audit = {
    originalName: 'Backend.pdf',
    cleanedName: 'Canonical.pdf',
    fileSize: 10,
    mimeType: 'application/pdf',
  };
  tracker.reset('session-1');
  assert.strictEqual(tracker.shouldEmit(audit), true);
  assert.strictEqual(tracker.shouldEmit(audit), false);
  tracker.reset('session-2');
  assert.strictEqual(tracker.shouldEmit(audit), true);
}

function testOriginalAndUploadedNamesAreStoredAsAnOrderedPair() {
  const audit = buildRenameAudit({
    sessionId: 'session-1',
    jobId: 'job-1',
    originalName: 'Oliver_Baltay.pdf',
    uploadedName: 'Eli Taylor.pdf',
    expectedName: 'Eli Taylor.pdf',
    fileSize: 100_540,
    mimeType: 'application/pdf',
  });

  assert.strictEqual(audit.originalFileName, 'Oliver_Baltay.pdf');
  assert.strictEqual(audit.originalName, 'Oliver_Baltay.pdf');
  assert.strictEqual(audit.submittedFileName, 'Eli Taylor.pdf');
  assert.strictEqual(audit.cleanedName, 'Eli Taylor.pdf');
  assert.strictEqual(audit.renamed, true);
  assert.strictEqual(audit.mismatch, false);

  const firstKey = resumeAuditOutboxKey(audit);
  const retryKey = resumeAuditOutboxKey({ ...audit });
  assert.ok(firstKey.startsWith('bidMonitorResumeAudit:session-1:'));
  assert.strictEqual(retryKey, firstKey);
}

testProfileUploadNameAndExtension();
testAshbyCopiedInputKeepsOriginal();
testDifferentSelectionReplacesOriginal();
testNewSessionClearsDedupe();
testOriginalAndUploadedNamesAreStoredAsAnOrderedPair();
console.log('resume-file-tracking.test.js: all passed');
