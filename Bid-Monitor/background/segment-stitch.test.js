/**
 * Unit tests for SegmentStitch — run with: node background/segment-stitch.test.js
 */
const assert = require('assert');
const { SegmentStitch } = require('./segment-stitch.js');

function testOrderByStartedAt() {
  const ordered = SegmentStitch.orderByStartedAt([
    { segmentId: 'b', startedAt: '2026-01-02T00:00:00.000Z' },
    { segmentId: 'a', startedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.deepStrictEqual(
    ordered.map((s) => s.segmentId),
    ['a', 'b'],
  );
}

function testStitchSingle() {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' });
  const result = SegmentStitch.stitchSegmentBlobs([blob], 'video/webm');
  assert.ok(result);
  assert.strictEqual(result.size, 3);
}

function testMultipleRequiresReencode() {
  const a = new Blob([new Uint8Array([1, 2])], { type: 'video/webm' });
  const b = new Blob([new Uint8Array([3, 4, 5])], { type: 'video/webm' });
  const result = SegmentStitch.stitchSegmentBlobs([a, b], 'video/webm');
  assert.strictEqual(result, null);
}

function testBuildFinalVideo() {
  const a = new Blob([new Uint8Array([1])], { type: 'video/webm' });
  const b = new Blob([new Uint8Array([2, 3])], { type: 'video/webm' });
  const built = SegmentStitch.buildFinalVideoFromSegments([
    { segmentId: 'b', startedAt: '2026-01-02T00:00:00.000Z', blob: b, mimeType: 'video/webm' },
    { segmentId: 'a', startedAt: '2026-01-01T00:00:00.000Z', blob: a, mimeType: 'video/webm' },
  ]);
  assert.ok(built.blob);
  assert.strictEqual(built.blob.size, 1);
  assert.deepStrictEqual(built.segmentIds, ['a']);
  assert.strictEqual(built.usedFallback, true);
}

function testEmpty() {
  const built = SegmentStitch.buildFinalVideoFromSegments([]);
  assert.strictEqual(built.blob, null);
}

function run() {
  testOrderByStartedAt();
  testStitchSingle();
  testMultipleRequiresReencode();
  testBuildFinalVideo();
  testEmpty();
  console.log('segment-stitch.test.js: all passed');
}

run();
