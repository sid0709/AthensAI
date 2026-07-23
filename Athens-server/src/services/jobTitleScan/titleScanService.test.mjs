import assert from "node:assert/strict";
import { parseTitleScanJson } from "./titleScanService.js";

const ids = ["a", "b", "c", "d"];

const parsed = parseTitleScanJson(
	JSON.stringify({
		results: [
			{ id: "a", role: "Software Engineer" },
			{ id: "b", role: "DevOps" },
			{ id: "c", role: "platform engineer" },
			{ id: "d", role: "Cloud Engineer" },
		],
	}),
	ids,
);

assert.equal(parsed.get("a"), "Software Engineer");
assert.equal(parsed.get("b"), "DevOps");
assert.equal(parsed.get("c"), "DevOps");
assert.equal(parsed.get("d"), "Others");

console.log("titleScanService.parseTitleScanJson ok");
