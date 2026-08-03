import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptSecret } from '@nextoffer/shared/secretCrypto';

import {
	decryptSelectedProfileSecrets,
	decryptProfileApiKeysForClient,
	preserveUnavailableProfileSecrets,
} from './autoBidProfileSecrets.js';

test('client profile reads redact KMS secrets when the key is unavailable', async () => {
	const previous = process.env.KMS_KEY_NAME;
	delete process.env.KMS_KEY_NAME;
	try {
		const result = await decryptProfileApiKeysForClient({
			fullName: 'Test User',
			gmailAppPassword: 'kms:v1:not-real-ciphertext',
		});
		assert.equal(result.profile.fullName, 'Test User');
		assert.equal(result.profile.gmailAppPassword, '');
		assert.deepEqual(result.unavailableFields, ['gmailAppPassword']);
	} finally {
		if (previous === undefined) delete process.env.KMS_KEY_NAME;
		else process.env.KMS_KEY_NAME = previous;
	}
});

test('client profile reads redact legacy secrets encrypted with another key', async () => {
	const previous = process.env.API_KEYS_ENCRYPTION_KEY;
	try {
		process.env.API_KEYS_ENCRYPTION_KEY = 'a'.repeat(64);
		const encrypted = encryptSecret('legacy-secret');
		process.env.API_KEYS_ENCRYPTION_KEY = 'b'.repeat(64);

		const result = await decryptProfileApiKeysForClient({
			fullName: 'Test User',
			openaiApiKey: encrypted,
		});

		assert.equal(result.profile.fullName, 'Test User');
		assert.equal(result.profile.openaiApiKey, '');
		assert.deepEqual(result.unavailableFields, ['openaiApiKey']);
	} finally {
		if (previous === undefined) delete process.env.API_KEYS_ENCRYPTION_KEY;
		else process.env.API_KEYS_ENCRYPTION_KEY = previous;
	}
});

test('saving a redacted profile preserves unavailable ciphertext', () => {
	const stored = { gmailAppPassword: 'kms:v1:stored-ciphertext' };
	assert.equal(
		preserveUnavailableProfileSecrets(
			{ fullName: 'Updated User', gmailAppPassword: '' },
			stored,
			['gmailAppPassword'],
		).gmailAppPassword,
		stored.gmailAppPassword,
	);
	assert.equal(
		preserveUnavailableProfileSecrets(
			{ gmailAppPassword: 'replacement' },
			stored,
			['gmailAppPassword'],
		).gmailAppPassword,
		'replacement',
	);
});

test('selected secret decryption redacts unrelated KMS secrets', async () => {
	const previous = process.env.KMS_KEY_NAME;
	delete process.env.KMS_KEY_NAME;
	try {
		const profile = await decryptSelectedProfileSecrets(
			{
				fullName: 'Test User',
				openaiApiKey: 'plain-api-key',
				gmailAppPassword: 'kms:v1:not-real-ciphertext',
				defaultPassword: 'kms:v1:not-real-ciphertext',
			},
			['openaiApiKey', 'deepseekApiKey'],
		);
		assert.equal(profile.fullName, 'Test User');
		assert.equal(profile.openaiApiKey, 'plain-api-key');
		assert.equal(profile.gmailAppPassword, '');
		assert.equal(profile.defaultPassword, '');
	} finally {
		if (previous === undefined) delete process.env.KMS_KEY_NAME;
		else process.env.KMS_KEY_NAME = previous;
	}
});
