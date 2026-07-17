import test from 'node:test';
import assert from 'node:assert/strict';

process.env.API_KEYS_ENCRYPTION_KEY = 'a'.repeat(64);

const { decryptProfileApiKeys, encryptProfileApiKeys } = await import('./profileApiKeys.js');

test('encryptProfileApiKeys encrypts openai and deepseek keys', () => {
  const encrypted = encryptProfileApiKeys({
    openaiApiKey: 'sk-openai',
    deepseekApiKey: 'sk-deepseek',
    email: 'a@b.com',
  });
  assert.match(encrypted.openaiApiKey, /^enc:v1:/);
  assert.match(encrypted.deepseekApiKey, /^enc:v1:/);
  assert.equal(encrypted.email, 'a@b.com');
});

test('decryptProfileApiKeys restores plaintext keys', () => {
  const encrypted = encryptProfileApiKeys({ openaiApiKey: 'sk-openai', deepseekApiKey: 'sk-deepseek' });
  const decrypted = decryptProfileApiKeys(encrypted);
  assert.equal(decrypted.openaiApiKey, 'sk-openai');
  assert.equal(decrypted.deepseekApiKey, 'sk-deepseek');
});

test('decryptProfileApiKeys leaves plaintext keys unchanged', () => {
  const profile = { openaiApiKey: 'sk-plain' };
  assert.equal(decryptProfileApiKeys(profile).openaiApiKey, 'sk-plain');
});
