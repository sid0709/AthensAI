import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
