import assert from "node:assert/strict";
import test from "node:test";
import {
	normalizeBidAiUsage,
	normalizeBidFlags,
	normalizeBidFormAnswers,
} from "./bidAiArtifactPersist.js";

test("preserves every valid suggested answer in order", () => {
	const answers = normalizeBidFormAnswers([
		{
			question: "Why are you interested?",
			suggestedAnswer: "I enjoy building reliable products.",
			confidence: "high",
		},
		{
			question: "Need sponsorship?",
			suggestedAnswer: "No.",
			confidence: "medium",
		},
	]);

	assert.equal(answers.length, 2);
	assert.equal(answers[0].question, "Why are you interested?");
	assert.equal(answers[1].suggestedAnswer, "No.");
});

test("links saved output to its AI usage request", () => {
	const usage = normalizeBidAiUsage(
		{
			model: "gpt-5-mini",
			inputTokens: 120,
			cachedTokens: 20,
			outputTokens: 30,
			totalTokens: 170,
			cost: 0.0012,
		},
		{
			requestId: "request-123",
			provider: "openai",
			requestedModel: "gpt-5-mini",
			billedModel: "gpt-5-mini-2026-06-01",
		},
	);

	assert.equal(usage.requestId, "request-123");
	assert.equal(usage.totalTokens, 170);
	assert.equal(usage.costUsd, 0.0012);
});

test("stores full remote and clearance verdicts", () => {
	const flags = normalizeBidFlags({
		remote: { status: "green", explanation: "Remote is explicitly allowed." },
		clearance: { status: "red", explanation: "A clearance is required." },
	});

	assert.deepEqual(flags.remote, {
		status: "green",
		explanation: "Remote is explicitly allowed.",
	});
	assert.deepEqual(flags.clearance, {
		status: "red",
		explanation: "A clearance is required.",
	});
});

