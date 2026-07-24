const assert = require('assert');
const {
  buildSubmittedFileName,
  createTracker,
} = require('./resume-file-tracking.js');

function file(name, size, type, lastModified) {
  return { name, size, type, lastModified };
}

function testCanonicalNameAndExtension() {
  const expected = 'LangChain - Senior Backend Engineer - Eli Taylor - abc123.pdf';
  assert.strictEqual(
    buildSubmittedFileName('Backend.pdf', expected, 'EliTaylor'),
    expected,
  );
  assert.strictEqual(
    buildSubmittedFileName('Backend.docx', expected, 'EliTaylor'),
    'LangChain - Senior Backend Engineer - Eli Taylor - abc123.docx',
  );
}

function testAshbyCopiedInputKeepsOriginal() {
  const tracker = createTracker();
  const expected = 'LangChain - Senior Backend Engineer - Eli Taylor - abc123.pdf';
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

testCanonicalNameAndExtension();
testAshbyCopiedInputKeepsOriginal();
testDifferentSelectionReplacesOriginal();
testNewSessionClearsDedupe();
console.log('resume-file-tracking.test.js: all passed');
