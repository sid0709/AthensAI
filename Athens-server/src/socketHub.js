import { Server } from 'socket.io';
import { createAdapter as createClusterAdapter } from '@socket.io/cluster-adapter';
import { createAdapter as createRedisAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { setupWorker } from '@socket.io/sticky';
import { SOCKET_PROTOCOL } from './config/socketProtocol.js';
import { requireFirebaseSocket } from './middleware/firebaseAuth.js';

let io = null;

function parseOrigins() {
	const raw = process.env.SOCKET_CORS_ORIGINS || process.env.CORS_ORIGINS || '*';
	if (raw.trim() === '*') return '*';
	return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function corsConfig() {
	const origins = parseOrigins();
	if (origins === '*') {
		return { origin: true, methods: ['GET', 'POST'] };
	}
	return { origin: origins, methods: ['GET', 'POST'] };
}

/**
 * @param {import('http').Server} httpServer
 * @param {{ clustered?: boolean }} [opts]
 */
export async function initSocket(httpServer, opts = {}) {
	io = new Server(httpServer, {
		cors: corsConfig(),
		pingInterval: 25_000,
		pingTimeout: 60_000,
		maxHttpBufferSize: 1e8,
		connectionStateRecovery: {
			maxDisconnectionDuration: 2 * 60 * 1000,
			skipMiddlewares: false,
		},
	});

	if (opts.clustered) {
		io.adapter(createClusterAdapter());
		setupWorker(io);
	} else if (String(process.env.REDIS_URL || '').trim()) {
		const pubClient = createClient({ url: process.env.REDIS_URL.trim() });
		const subClient = pubClient.duplicate();
		await Promise.all([pubClient.connect(), subClient.connect()]);
		io.adapter(createRedisAdapter(pubClient, subClient, { key: "athens-api" }));
		io.redisClients = [pubClient, subClient];
		console.log('[socket] Redis adapter connected');
	}

	io.use(requireFirebaseSocket);

	io.on('connection', (socket) => {
		console.log('[socket] client connected:', socket.id);
		const profileIds = socket.data.requestedProfile
			? [socket.data.requestedProfile]
			: [...(socket.data.profileAccess?.profileIds || [])];
		for (const profileId of profileIds) socket.join(`profile:${profileId}`);

		socket.emit('server:hello', {
			ok: true,
			service: 'lancer-backend',
			timestamp: new Date().toISOString(),
		});

		socket.on(SOCKET_PROTOCOL.TYPE.CONNECTION, (data) => {
			const payload = data?.payload;
			if (!payload) return;

			if (
				payload.purpose === SOCKET_PROTOCOL.IDENTIFIER.PURPOSE.CHECK_CONNECTIONS
				&& payload.tgt === SOCKET_PROTOCOL.LOCATION.BACKEND
			) {
				socket.emit(SOCKET_PROTOCOL.TYPE.CONNECTION, {
					payload: {
						...payload,
						ok: true,
						timestamp: new Date().toISOString(),
						src: SOCKET_PROTOCOL.LOCATION.BACKEND,
						tgt: payload.src,
					},
				});
				return;
			}

			// Relay extension ↔ frontend checks to other clients.
			if (payload.tgt && payload.tgt !== SOCKET_PROTOCOL.LOCATION.BACKEND) {
				const rooms = profileIds.map((profileId) => `profile:${profileId}`);
				if (rooms.length) socket.to(rooms).emit(SOCKET_PROTOCOL.TYPE.CONNECTION, data);
			}
		});
	});

	const origins = parseOrigins();
	console.log('[socket] Socket.IO ready (CORS:', origins === '*' ? '*' : origins.join(', '), ')');
	return io;
}

export function getIO() {
	return io;
}

export async function closeSocket() {
	if (!io) return;
	await Promise.all((io.redisClients || []).map((client) => client.quit().catch(() => undefined)));
	await new Promise((resolve) => {
		io.close(() => resolve());
		setTimeout(resolve, 3000);
	});
	io = null;
}
