import { Server } from 'socket.io';
import { SOCKET_PROTOCOL } from './config/socketProtocol.js';

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

export function initSocket(httpServer) {
	io = new Server(httpServer, { cors: corsConfig() });

	io.on('connection', (socket) => {
		console.log('[socket] client connected:', socket.id);

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
				socket.broadcast.emit(SOCKET_PROTOCOL.TYPE.CONNECTION, data);
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
