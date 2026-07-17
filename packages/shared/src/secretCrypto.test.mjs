import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSecret, encryptSecret, isEncryptedSecret } from './secretCrypto.js';

const TEST_KEY = 'a'.repeat(64);

test('encryptSecret round-trips plaintext', () => {
  process.env.API_KEYS_ENCRYPTION_KEY = TEST_KEY;
  const encrypted = encryptSecret('sk-test-key-123');
  assert.ok(isEncryptedSecret(encrypted));
  assert.equal(decryptSecret(encrypted), 'sk-test-key-123');
});

test('encryptSecret returns empty for empty input', () => {
  process.env.API_KEYS_ENCRYPTION_KEY = TEST_KEY;
  assert.equal(encryptSecret(''), '');
  assert.equal(decryptSecret(''), '');
});

test('decryptSecret returns plaintext unchanged when not encrypted', () => {
  process.env.API_KEYS_ENCRYPTION_KEY = TEST_KEY;
  assert.equal(decryptSecret('sk-plain'), 'sk-plain');
});

test('encryptSecret is idempotent for already-encrypted values', () => {
  process.env.API_KEYS_ENCRYPTION_KEY = TEST_KEY;
  const once = encryptSecret('sk-test');
  const twice = encryptSecret(once);
  assert.equal(once, twice);
});

test('encryptSecret throws when key is missing', () => {
  delete process.env.API_KEYS_ENCRYPTION_KEY;
  assert.throws(() => encryptSecret('sk-test'), /API_KEYS_ENCRYPTION_KEY is required/);
});

test('different plaintexts produce different ciphertexts', () => {
  process.env.API_KEYS_ENCRYPTION_KEY = TEST_KEY;
  const a = encryptSecret('sk-one');
  const b = encryptSecret('sk-two');
  assert.notEqual(a, b);
});
