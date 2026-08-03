import assert from "node:assert/strict";
import test from "node:test";

import config from "./vite.config.js";

test("does not emit module preloads for extension pages", () => {
	assert.equal(config.build.modulePreload, false);
});
