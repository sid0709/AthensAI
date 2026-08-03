import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_NARRATIVE_SCENES } from "./authNarrative";

test("career-galaxy narrative unfolds across six complete chapters", () => {
  assert.equal(AUTH_NARRATIVE_SCENES.length, 6);
  assert.equal(new Set(AUTH_NARRATIVE_SCENES.map((scene) => scene.code)).size, 6);
  assert.ok(AUTH_NARRATIVE_SCENES.every((scene) => (
    scene.code && scene.title && scene.body && scene.metric && scene.value
  )));
});

test("narrative opens with the galaxy and ends with agency", () => {
  assert.match(AUTH_NARRATIVE_SCENES[0].title, /galaxy/i);
  assert.match(AUTH_NARRATIVE_SCENES[1].title, /job.*star/i);
  assert.match(AUTH_NARRATIVE_SCENES.at(-1)?.title ?? "", /conquer.*star/i);
});
