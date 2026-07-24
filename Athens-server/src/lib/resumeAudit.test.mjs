import test from "node:test";
import assert from "node:assert/strict";

import { resolveResumeOriginalName } from "./resumeAudit.js";

test("canonical echo cannot overwrite original in the same session", () => {
	assert.equal(
		resolveResumeOriginalName({
			existingOriginalName: "Backend.pdf",
			existingExpectedName: "LangChain - Backend - Eli - abc.pdf",
			existingCleanedName: "LangChain - Backend - Eli - abc.pdf",
			existingSessionId: "session-1",
			incomingOriginalName: "LangChain - Backend - Eli - abc.pdf",
			incomingExpectedName: "LangChain - Backend - Eli - abc.pdf",
			incomingCleanedName: "LangChain - Backend - Eli - abc.pdf",
			incomingSessionId: "session-1",
		}),
		"Backend.pdf",
	);
});

test("a genuinely different selection replaces the original", () => {
	assert.equal(
		resolveResumeOriginalName({
			existingOriginalName: "Backend.pdf",
			existingExpectedName: "Canonical.pdf",
			existingCleanedName: "Canonical.pdf",
			existingSessionId: "session-1",
			incomingOriginalName: "Platform.pdf",
			incomingExpectedName: "Canonical.pdf",
			incomingCleanedName: "Canonical.pdf",
			incomingSessionId: "session-1",
		}),
		"Platform.pdf",
	);
});

test("a new session may intentionally replace a previous original", () => {
	assert.equal(
		resolveResumeOriginalName({
			existingOriginalName: "Backend.pdf",
			existingExpectedName: "Canonical.pdf",
			existingCleanedName: "Canonical.pdf",
			existingSessionId: "session-1",
			incomingOriginalName: "Canonical.pdf",
			incomingExpectedName: "Canonical.pdf",
			incomingCleanedName: "Canonical.pdf",
			incomingSessionId: "session-2",
		}),
		"Canonical.pdf",
	);
});
