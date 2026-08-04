import { calculateCost, resolveModelPricing, DEFAULT_DEEPSEEK_MODEL } from './pricing.js';
import { isValidApiKey } from './api-keys.js';
import { estimateTokens, parseChatRequest } from './validation.js';
import { admissionLane, GatewayAdmissionPool } from './admission.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function runTests() {
  assert(!isValidApiKey('sk-...'), 'placeholder sk-... rejected');
  assert(!isValidApiKey(''), 'empty rejected');

  const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };
  const cost = calculateCost('gpt-4o-mini', usage);
  assert(cost.promptUsd === 0.00015, `prompt cost ${cost.promptUsd}`);
  assert(cost.completionUsd === 0.0003, `completion cost ${cost.completionUsd}`);
  assert(cost.totalUsd === 0.00045, `total cost ${cost.totalUsd}`);

  const cachedUsage = {
    promptTokens: 1000,
    cachedTokens: 800,
    completionTokens: 500,
    totalTokens: 1500,
  };
  const cachedCost = calculateCost('gpt-4o', cachedUsage);
  assert(cachedCost.totalUsd === 0.0065, `cached gpt-4o cost ${cachedCost.totalUsd}`);

  const gpt5 = resolveModelPricing('gpt-5.2');
  assert(gpt5.promptPer1M === 1.75, `gpt-5.2 input rate ${gpt5.promptPer1M}`);
  assert(gpt5.completionPer1M === 14, `gpt-5.2 output rate ${gpt5.completionPer1M}`);

  const deepseekFlash = resolveModelPricing(DEFAULT_DEEPSEEK_MODEL);
  assert(deepseekFlash.provider === 'deepseek', 'deepseek-v4-flash provider');

  const deepseekLegacy = resolveModelPricing('deepseek-chat');
  assert(deepseekLegacy.provider === 'deepseek', 'legacy deepseek-chat maps to deepseek');

  const gptFallback = resolveModelPricing('gpt-4o-mini');
  assert(gptFallback.provider === 'openai', 'gpt catalog hit');

  assert(estimateTokens('hello world') >= 2, 'token estimate');

  const extractionRequest = parseChatRequest({
    model: 'gpt-5-nano',
    messages: [{ role: 'user', content: 'Extract skills' }],
    maxTokens: 1400,
    reasoningEffort: 'minimal',
  });
  assert(!('maxTokens' in extractionRequest), 'application token caps are discarded');
  assert(extractionRequest.reasoningEffort === 'minimal', 'reasoning effort parsed');

  const billedUsage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };
  const billedCost = calculateCost('gpt-4o-mini-2024-07-18', billedUsage);
  assert(billedCost.totalUsd === 0.00045, `billed model cost ${billedCost.totalUsd}`);

  assert(admissionLane({ messages: [{ role: 'user', content: 'x' }] }) === 'interactive', 'default workload is interactive');
  assert(admissionLane({
    messages: [{ role: 'user', content: 'x' }],
    workloadClass: 'background',
    feature: 'job-title-review',
  }) === 'title', 'title review gets a fair background lane');

  const pool = new GatewayAdmissionPool({ globalConcurrency: 1, interactiveConcurrency: 1 });
  let releaseFirst!: () => void;
  const first = pool.run('resume', undefined, () => new Promise<void>((resolve) => { releaseFirst = resolve; }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(pool.snapshot().active === 1, 'gateway global ceiling is enforced');
  const controller = new AbortController();
  let secondStarted = false;
  const second = pool.run('title', controller.signal, async () => { secondStarted = true; });
  controller.abort(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
  await second.catch(() => undefined);
  assert(!secondStarted, 'cancelled queued work never starts a provider call');
  releaseFirst();
  await first;

  console.log('ai-bff ok');
}

await runTests();
