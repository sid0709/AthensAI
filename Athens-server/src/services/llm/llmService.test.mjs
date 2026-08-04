import test from "node:test";
import assert from "node:assert/strict";

import {
  chatCompletion,
  isRequestTimeoutError,
  isModelCompatibleWithProvider,
  resolveDefaultModel,
  summarizeUsage,
} from "./llmService.js";

test("the saved profile default wins even when both provider keys exist", () => {
  assert.deepEqual(
    resolveDefaultModel({
      openaiApiKey: "openai-key",
      deepseekApiKey: "deepseek-key",
      defaultProvider: "deepseek",
      defaultModel: "deepseek-v4-flash",
    }),
    {
      provider: "deepseek",
      apiKey: "deepseek-key",
      model: "deepseek-v4-flash",
      configured: true,
      error: null,
    },
  );
});

test("missing or cross-provider profile defaults never fall back to GPT", async () => {
  const missing = resolveDefaultModel({ openaiApiKey: "openai-key" });
  assert.equal(missing.model, "");
  assert.equal(missing.configured, false);

  const mismatched = resolveDefaultModel({
    deepseekApiKey: "deepseek-key",
    defaultProvider: "deepseek",
    defaultModel: "gpt-5.4-mini",
  });
  assert.equal(mismatched.model, "");
  assert.match(mismatched.error, /different provider/);
  assert.equal(isModelCompatibleWithProvider("deepseek", "deepseek-v4-flash"), true);
  assert.equal(isModelCompatibleWithProvider("deepseek", "gpt-5.4-mini"), false);
  assert.equal(isModelCompatibleWithProvider("", "gpt-5.4-mini"), false);

  await assert.rejects(
    chatCompletion({
      provider: "deepseek",
      apiKey: "deepseek-key",
      model: "",
      messages: [{ role: "user", content: "test" }],
    }),
    /No default AI model/,
  );
});

test("summarizeUsage matches codex pricing for DeepSeek cache hit/miss", () => {
  const raw = {
    prompt_cache_hit_tokens: 16_545_664,
    prompt_cache_miss_tokens: 206_801,
    completion_tokens: 102_043,
    total_tokens: 16_854_508,
  };
  const u = summarizeUsage(raw, "deepseek-v4-flash");
  assert.equal(u.inputTokens, 206_801);
  assert.equal(u.cachedTokens, 16_545_664);
  assert.ok(u.cost != null && u.cost > 0);
  assert.ok(Math.abs(u.cost - 0.104) < 0.002);
  assert.ok(u.savings != null && u.savings > 0);
});

test("summarizeUsage OpenAI cached input still works", () => {
  const u = summarizeUsage(
    {
      prompt_tokens: 1000,
      prompt_tokens_details: { cached_tokens: 400 },
      completion_tokens: 200,
      total_tokens: 1200,
    },
    "gpt-4o-mini",
  );
  assert.equal(u.inputTokens, 600);
  assert.equal(u.cachedTokens, 400);
  assert.ok(u.priced);
});

test("request timeouts are terminal rather than retryable network errors", () => {
  assert.equal(isRequestTimeoutError({ name: "TimeoutError" }), true);
  assert.equal(isRequestTimeoutError({ cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }), true);
  assert.equal(isRequestTimeoutError({ name: "TypeError", cause: { code: "ECONNRESET" } }), false);
});
