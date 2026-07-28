import { Server } from 'socket.io';

export const EXTENSION_SCRAPER_SOCKET_PROTOCOL = {
	TYPE: {
		CONNECTION: 'connection',
		SCRAPER: 'scraper',
	},
	LOCATION: {
		BACKEND: 'backend',
	},
	PURPOSE: {
		CHECK_CONNECTIONS: 'check_connections',
		REGISTER: 'register',
		HEARTBEAT: 'heartbeat',
	},
};

let scraperIO = null;

function parseCorsOrigins() {
	const raw = String(process.env.SOCKET_CORS_ORIGINS || process.env.CORS_ORIGIN || '*').trim();
	if (!raw || raw.split(',').some((value) => value.trim() === '*')) return true;
	return raw.split(',').map((value) => value.trim()).filter(Boolean);
}

export function extensionScraperServerHello(now = new Date()) {
	return {
		ok: true,
		service: 'lancer-backend',
		timestamp: now.toISOString(),
	};
}

export function extensionScraperConnectionReply(data, now = new Date()) {
	const payload = data?.payload;
	if (
		!payload
		|| payload.purpose !== EXTENSION_SCRAPER_SOCKET_PROTOCOL.PURPOSE.CHECK_CONNECTIONS
		|| payload.tgt !== EXTENSION_SCRAPER_SOCKET_PROTOCOL.LOCATION.BACKEND
	) {
		return null;
	}
	return {
		payload: {
			...payload,
			ok: true,
			timestamp: now.toISOString(),
			src: EXTENSION_SCRAPER_SOCKET_PROTOCOL.LOCATION.BACKEND,
			tgt: payload.src,
		},
	};
}

/** Attach the legacy scraper compatibility endpoint at the default /socket.io path. */
export function initExtensionScraperSocket(httpServer) {
	if (scraperIO) return scraperIO;
	scraperIO = new Server(httpServer, {
		path: '/socket.io',
		cors: { origin: parseCorsOrigins(), methods: ['GET', 'POST'] },
		pingInterval: 25_000,
		pingTimeout: 60_000,
		maxHttpBufferSize: 1e6,
	});

	scraperIO.on('connection', (socket) => {
		socket.emit('server:hello', extensionScraperServerHello());

		socket.on(EXTENSION_SCRAPER_SOCKET_PROTOCOL.TYPE.CONNECTION, (data) => {
			const reply = extensionScraperConnectionReply(data);
			if (reply) socket.emit(EXTENSION_SCRAPER_SOCKET_PROTOCOL.TYPE.CONNECTION, reply);
		});

		// Registration and heartbeat are intentionally state-free. The original
		// extension uses them to keep the connection alive; job writes remain REST-only.
		socket.on(EXTENSION_SCRAPER_SOCKET_PROTOCOL.TYPE.SCRAPER, (data) => {
			const payload = data?.payload;
			if (!payload || payload.tgt !== EXTENSION_SCRAPER_SOCKET_PROTOCOL.LOCATION.BACKEND) return;
			if (
				payload.purpose === EXTENSION_SCRAPER_SOCKET_PROTOCOL.PURPOSE.REGISTER
				|| payload.purpose === EXTENSION_SCRAPER_SOCKET_PROTOCOL.PURPOSE.HEARTBEAT
			) {
				socket.data.extensionScraper = {
					scraping: payload.scraping === true,
					lastJobAt: payload.lastJobAt || null,
					updatedAt: new Date().toISOString(),
				};
			}
		});
	});

	console.log('[extension-scraper] Socket.IO compatibility ready on /socket.io');
	return scraperIO;
}

export async function closeExtensionScraperSocket() {
	if (!scraperIO) return;
	const io = scraperIO;
	scraperIO = null;
	await new Promise((resolve) => io.close(resolve));
}
