import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
	closeExtensionScraperSocket,
	extensionScraperConnectionReply,
	extensionScraperServerHello,
	initExtensionScraperSocket,
} from './extensionScraperSocket.js';

test('legacy scraper connection check receives the expected backend reply', () => {
	const now = new Date('2026-07-28T17:00:00.000Z');
	assert.deepEqual(extensionScraperServerHello(now), {
		ok: true,
		service: 'lancer-backend',
		timestamp: now.toISOString(),
	});
	assert.deepEqual(extensionScraperConnectionReply({
		payload: {
			purpose: 'check_connections',
			src: 'extension',
			tgt: 'backend',
		},
	}, now), {
		payload: {
			purpose: 'check_connections',
			src: 'backend',
			tgt: 'extension',
			ok: true,
			timestamp: now.toISOString(),
		},
	});
	assert.equal(extensionScraperConnectionReply({ payload: { purpose: 'other', tgt: 'backend' } }, now), null);
});

test('legacy Socket.IO polling handshake is served at the Athens-server default path', async (t) => {
	const server = http.createServer((_req, res) => res.writeHead(404).end('Not found'));
	initExtensionScraperSocket(server);
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(async () => {
		await closeExtensionScraperSocket();
		if (server.listening) await new Promise((resolve) => server.close(resolve));
	});

	const address = server.address();
	const response = await fetch(`http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling`);
	assert.equal(response.status, 200);
	const body = await response.text();
	assert.match(body, /^0\{"sid":"[^"]+"/);
});
