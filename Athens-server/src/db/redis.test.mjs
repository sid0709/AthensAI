import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { attachRedisErrorHandler, isRedisConnectionError } from './redis.js';

test('Redis client guards consume error events without terminating the process', () => {
	const redisClient = new EventEmitter();
	const messages = [];
	attachRedisErrorHandler(redisClient, {
		label: 'test duplicate',
		logger: (...parts) => messages.push(parts.join(' ')),
	});

	assert.doesNotThrow(() => redisClient.emit('error', new Error('socket disappeared')));
	assert.deepEqual(messages, ['[redis] test duplicate error: socket disappeared']);
});

test('Redis client guards attach only one error listener per client', () => {
	const redisClient = new EventEmitter();
	attachRedisErrorHandler(redisClient, { logger: () => undefined });
	attachRedisErrorHandler(redisClient, { logger: () => undefined });
	assert.equal(redisClient.listenerCount('error'), 1);
});

test('Redis connection failures are classified for temporary-unavailable responses', () => {
	assert.equal(isRedisConnectionError(Object.assign(new Error('Socket closed unexpectedly'), {
		name: 'SocketClosedUnexpectedlyError',
	})), true);
	assert.equal(isRedisConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:6379')), true);
	assert.equal(isRedisConnectionError(new Error('Invalid task payload')), false);
});
