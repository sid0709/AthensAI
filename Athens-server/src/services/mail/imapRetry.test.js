import assert from 'node:assert/strict';
import test from 'node:test';
import {
	formatImapError,
	isRetryableImapError,
	withImapRetry,
} from './imapRetry.js';

test('formatImapError appends responseStatus and responseText', () => {
	const error = Object.assign(new Error('Command failed'), {
		responseStatus: 'NO',
		responseText: '[THROTTLED] Slow down',
	});
	assert.equal(formatImapError(error), 'Command failed: NO [THROTTLED] Slow down');
});

test('formatImapError keeps plain messages without IMAP detail', () => {
	assert.equal(formatImapError(new Error('Message not found')), 'Message not found');
	assert.equal(formatImapError('raw string'), 'raw string');
});

test('formatImapError does not duplicate already-enriched messages', () => {
	const message = 'Command failed: NO Temporary System Error';
	const error = Object.assign(new Error(message), {
		responseStatus: 'NO',
		responseText: 'Temporary System Error',
	});
	assert.equal(formatImapError(error), message);
});

test('isRetryableImapError accepts imapflow command failures and pool exhaustion', () => {
	assert.equal(isRetryableImapError(new Error('Command failed')), true);
	assert.equal(
		isRetryableImapError(Object.assign(new Error('Command failed'), { responseStatus: 'NO' })),
		true,
	);
	assert.equal(isRetryableImapError(new Error('IMAP connection pool exhausted — all connections busy')), true);
	assert.equal(isRetryableImapError(new Error('read ETIMEDOUT')), true);
});

test('isRetryableImapError rejects aborts and unrelated errors', () => {
	const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
	assert.equal(isRetryableImapError(abort), false);
	assert.equal(isRetryableImapError(new Error('Command failed'), { aborted: true }), false);
	assert.equal(isRetryableImapError(new Error('No LLM API key on applier profile')), false);
});

test('withImapRetry retries transient failures then succeeds', async () => {
	let attempts = 0;
	const result = await withImapRetry(async () => {
		attempts += 1;
		if (attempts < 3) {
			throw Object.assign(new Error('Command failed'), {
				responseStatus: 'NO',
				responseText: 'Temporary System Error',
			});
		}
		return 'ok';
	}, { attempts: 3, baseDelayMs: 5 });

	assert.equal(result, 'ok');
	assert.equal(attempts, 3);
});

test('withImapRetry surfaces enriched error after exhausting retries', async () => {
	await assert.rejects(
		() => withImapRetry(
			async () => {
				throw Object.assign(new Error('Command failed'), {
					responseStatus: 'NO',
					responseText: '[UNAVAILABLE] Temporary failure',
				});
			},
			{ attempts: 2, baseDelayMs: 5 },
		),
		(error) => {
			assert.match(String(error.message), /Command failed: NO \[UNAVAILABLE\] Temporary failure/);
			return true;
		},
	);
});

test('withImapRetry does not retry AbortError', async () => {
	let attempts = 0;
	await assert.rejects(
		() => withImapRetry(
			async () => {
				attempts += 1;
				throw Object.assign(new Error('Mail AI labeling cancelled'), { name: 'AbortError' });
			},
			{ attempts: 3, baseDelayMs: 5 },
		),
		(error) => error.name === 'AbortError',
	);
	assert.equal(attempts, 1);
});
