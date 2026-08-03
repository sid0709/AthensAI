import assert from "node:assert/strict";
import test from "node:test";
import { createSignalPoints, nextAuthScene } from "./authScene";

test("scroll navigation advances one scene and stays within bounds", () => {
  assert.equal(nextAuthScene(0, 120, 6), 1);
  assert.equal(nextAuthScene(1, -120, 6), 0);
  assert.equal(nextAuthScene(3, 0, 6), 3);
  assert.equal(nextAuthScene(4, 120, 6), 5);
  assert.equal(nextAuthScene(5, 120, 6), 5);
  assert.equal(nextAuthScene(0, -120, 6), 0);
});

test("signal points are deterministic and remain on the configured sphere", () => {
  const first = createSignalPoints();
  const second = createSignalPoints();

  assert.equal(first.length, 62);
  assert.deepEqual(first, second);
  assert.ok(first.every((point) => point.latitude >= 0 && point.latitude <= Math.PI));
  assert.ok(first.every((point) => point.longitude >= 0 && point.longitude <= Math.PI * 2));
  assert.ok(first.every((point) => point.size >= 0.75 && point.size <= 2.3));
  assert.ok(first.every((point) => point.scatterX >= -1 && point.scatterX <= 1));
  assert.ok(first.every((point) => point.scatterY >= -1 && point.scatterY <= 1));
});
