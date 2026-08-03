import test from 'node:test';
import assert from 'node:assert/strict';
import { agentControllerTest } from './agentController.js';

test('manual job URLs are canonicalized and tracking fragments are removed', () => {
  assert.equal(
    agentControllerTest.canonicalJobUrl('https://jobs.example.com/role?utm_source=test&id=42#apply'),
    'https://jobs.example.com/role?id=42',
  );
  assert.throws(() => agentControllerTest.canonicalJobUrl('javascript:alert(1)'), /http or https/);
});

test('manual job descriptions strip markup, scripts, and control characters', () => {
  const result = agentControllerTest.sanitizedJobDescription(
    '<style>secret-style</style><script>secret-script</script><p>Build systems\u0000 safely.</p>',
  );
  assert.equal(result, 'Build systems safely.');
});

test('agent AI uses only the profile default provider, model, and matching key', () => {
  const result = agentControllerTest.resolveAgentProfileChat({
    openaiApiKey: 'openai-key',
    deepseekApiKey: 'deepseek-key',
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-v4-flash',
  });

  assert.equal(result.provider, 'deepseek');
  assert.equal(result.model, 'deepseek-v4-flash');
  assert.deepEqual(result.apiKeys, { deepseek: 'deepseek-key' });
});

test('agent AI ignores unrelated encrypted profile secrets', async () => {
  const previous = process.env.KMS_KEY_NAME;
  delete process.env.KMS_KEY_NAME;
  try {
    const profile = await agentControllerTest.decryptAgentAiProfile({
      defaultProvider: 'deepseek',
      defaultModel: 'deepseek-v4-flash',
      deepseekApiKey: 'deepseek-key',
      openaiApiKey: 'kms:v1:unavailable-openai-key',
      gmailAppPassword: 'kms:v1:unavailable-mail-secret',
      defaultPassword: 'kms:v1:unavailable-browser-secret',
    });

    assert.equal(profile.deepseekApiKey, 'deepseek-key');
    assert.equal(profile.openaiApiKey, '');
    assert.equal(profile.gmailAppPassword, '');
    assert.equal(profile.defaultPassword, '');
  } finally {
    if (previous === undefined) delete process.env.KMS_KEY_NAME;
    else process.env.KMS_KEY_NAME = previous;
  }
});
