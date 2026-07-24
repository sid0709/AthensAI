/**
 * Avalon Socket.IO relay — dedicated process (isolated from Athens-server batch load).
 * Serves HTTP under /avalon/* and Socket.IO on path /avalon/socket.io.
 */

import { Server } from "socket.io";
import {
	DEFAULT_SESSION_ID,
	SOCKET_EVENTS,
} from "@avalon/shared";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

const sessions = new Map();
const DEFAULT_PROFILE_ID = "default";

function resolveProfileId(profileId) {
	const trimmed = typeof profileId === "string" ? profileId.trim() : "";
	return trimmed || DEFAULT_PROFILE_ID;
}

function resolveSessionId(sessionId) {
	const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
	return trimmed || DEFAULT_SESSION_ID;
}

function makeSessionKey(profileId, sessionId) {
	return `${resolveProfileId(profileId)}::${resolveSessionId(sessionId)}`;
}

function sessionRoom(session) { return `avalon:${session.key}`; }
function roleRoom(session, role) { return `${sessionRoom(session)}:${role}`; }

async function emitClusterPeerStatus(io, session) {
	const [extensions, controllers] = await Promise.all([
		io.in(roleRoom(session, "extension")).fetchSockets(),
		io.in(roleRoom(session, "controller")).fetchSockets(),
	]);
	io.to(sessionRoom(session)).emit("peers-update", {
		sessionId: session.sessionId,
		profileId: session.profileId,
		peers: { extension: extensions.length > 0, controller: controllers.length > 0 },
	});
}

function getOrCreateSession(profileId, sessionId) {
	const key = makeSessionKey(profileId, sessionId);
	const existing = sessions.get(key);
	if (existing) return existing;

	const session = {
		key,
		profileId: resolveProfileId(profileId),
		sessionId: resolveSessionId(sessionId),
		observers: new Set(),
	};
	sessions.set(session.key, session);
	return session;
}

function peerStatus(session) {
	return {
		extension: Boolean(session.extension?.connected),
		controller: Boolean(session.controller?.connected),
	};
}

function emitPeerStatus(session) {
	const payload = {
		sessionId: session.sessionId,
		profileId: session.profileId,
		peers: peerStatus(session),
	};
	session.extension?.emit("peers-update", payload);
	session.controller?.emit("peers-update", payload);
}

function cleanupSocket(socket) {
	for (const [id, session] of sessions.entries()) {
		if (session.extension?.id === socket.id) {
			session.extension = undefined;
			emitPeerStatus(session);
		}
		if (session.controller?.id === socket.id) {
			session.controller = undefined;
			emitPeerStatus(session);
		}
		session.observers.delete(socket);
		if (!session.extension && !session.controller && session.observers.size === 0) {
			sessions.delete(id);
		}
	}
}

function toRelaySessionInfo(session) {
	return {
		profileId: session.profileId,
		sessionId: session.sessionId,
		...(session.label ? { label: session.label } : {}),
		peers: peerStatus(session),
	};
}

function listSessions(profileId) {
	const want = typeof profileId === "string" ? profileId.trim() : "";
	return [...sessions.values()]
		.filter((s) => !want || s.profileId === want)
		.map(toRelaySessionInfo);
}

function parseCorsOrigin() {
	const raw = process.env.AVALON_CORS_ORIGIN || process.env.CORS_ORIGIN || "*";
	if (!raw.trim() || raw.trim() === "*" || raw.split(",").some((value) => value.trim() === "*")) return true;
	return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function envInt(name, fallback) {
	const n = Number.parseInt(String(process.env[name] ?? ""), 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Mount Avalon HTTP routes (call before the catch-all 404).
 * @param {import('express').Express} app
 */
export function mountAvalonRelayRoutes(app) {
	app.get("/avalon/health", (_req, res) => {
		const active = listSessions();
		res.json({ ok: true, sessions: active.length, active });
	});

	app.get("/avalon/sessions", (req, res) => {
		const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
		const active = listSessions(profileId);
		res.json({ ok: true, sessions: active.length, active });
	});
}

/**
 * Attach Avalon Socket.IO to the HTTP server (path /avalon/socket.io).
 * @param {import('http').Server} httpServer
 */
export async function initAvalonRelay(httpServer) {
	const corsOrigin = parseCorsOrigin();
	const pingInterval = envInt("AVALON_PING_INTERVAL_MS", 25_000);
	const pingTimeout = envInt("AVALON_PING_TIMEOUT_MS", 60_000);

	const io = new Server(httpServer, {
		path: "/avalon/socket.io",
		cors: { origin: corsOrigin },
		pingInterval,
		pingTimeout,
		connectionStateRecovery: {
			maxDisconnectionDuration: 2 * 60 * 1000,
			skipMiddlewares: false,
		},
		maxHttpBufferSize: 1e8,
	});
	const redisUrl = String(process.env.REDIS_URL || "").trim();
	if (redisUrl) {
		const pubClient = createClient({ url: redisUrl });
		const subClient = pubClient.duplicate();
		await Promise.all([pubClient.connect(), subClient.connect()]);
		io.adapter(createAdapter(pubClient, subClient, { key: "avalon-relay" }));
		io.redisClients = [pubClient, subClient];
		console.log("[avalon-relay] Redis Socket.IO adapter connected");
	}

	io.on("connection", (socket) => {
		let boundSession = null;
		console.log(`[avalon-relay] connect ${socket.id}`);

		socket.on(SOCKET_EVENTS.REGISTER, (payload, ack) => {
			const session = getOrCreateSession(payload?.profileId, payload?.sessionId);

			if (boundSession && boundSession !== session) {
				const prev = boundSession;
				if (prev.extension?.id === socket.id) prev.extension = undefined;
				if (prev.controller?.id === socket.id) prev.controller = undefined;
				prev.observers.delete(socket);
				emitPeerStatus(prev);
				if (!prev.extension && !prev.controller && prev.observers.size === 0) {
					sessions.delete(prev.key);
				}
			}

			boundSession = session;
			const role = payload?.role === "extension" ? "extension" : payload?.role === "observer" ? "observer" : "controller";
			socket.join(sessionRoom(session));
			socket.join(roleRoom(session, role));
			socket.data.avalonSession = { profileId: session.profileId, sessionId: session.sessionId, role };

			if (payload?.role === "extension") {
				if (session.extension && session.extension.id !== socket.id) {
					session.extension.disconnect();
				}
				session.extension = socket;
			} else if (payload?.role === "observer") {
				session.observers.add(socket);
			} else {
				if (session.controller && session.controller.id !== socket.id) {
					session.controller.disconnect();
				}
				session.controller = socket;
				const label = typeof payload?.label === "string" ? payload.label.trim() : "";
				if (label) session.label = label;
			}

			const response = {
				clientId: socket.id,
				profileId: session.profileId,
				sessionId: session.sessionId,
				role: payload?.role,
				peers: peerStatus(session),
			};

			if (typeof ack === "function") ack(response);
			socket.emit(SOCKET_EVENTS.REGISTERED, response);
			emitPeerStatus(session);
			void emitClusterPeerStatus(io, session);
			console.log(
				`[avalon-relay] register profile=${session.profileId} session=${session.sessionId} role=${payload?.role} client=${socket.id}`,
			);
		});

		socket.on(SOCKET_EVENTS.EXECUTE_ACTION, async (action) => {
			const extensions = boundSession ? await io.in(roleRoom(boundSession, "extension")).fetchSockets() : [];
			if (!extensions.length) {
				console.warn(
					`[avalon-relay] execute-action ${action?.id} — no extension in session=${boundSession?.sessionId ?? "-"}`,
				);
				socket.emit(SOCKET_EVENTS.ACTION_RESULT, {
					actionId: action?.id,
					success: false,
					error: "No extension connected in this session",
				});
				return;
			}
			console.log(
				`[avalon-relay] execute-action → session=${boundSession.sessionId} id=${action?.id} action=${action?.action}`,
			);
			io.to(roleRoom(boundSession, "extension")).emit(SOCKET_EVENTS.EXECUTE_ACTION, action);
		});

		socket.on(SOCKET_EVENTS.ACTION_RESULT, (result) => {
			console.log(
				`[avalon-relay] action-result ← session=${boundSession?.sessionId ?? "-"} id=${result?.actionId} success=${result?.success}`,
			);
			if (boundSession) io.to(roleRoom(boundSession, "controller")).emit(SOCKET_EVENTS.ACTION_RESULT, result);
		});

		socket.on(SOCKET_EVENTS.APPLY_PROGRESS, (progress) => {
			if (!boundSession) return;
			console.log(
				`[avalon-relay] apply-progress session=${boundSession.sessionId} phase=${progress?.phase}`,
			);
			io.to(roleRoom(boundSession, "controller")).to(roleRoom(boundSession, "observer")).emit(SOCKET_EVENTS.APPLY_PROGRESS, progress);
		});

		socket.on(SOCKET_EVENTS.TABS_UPDATE, (tabs) => {
			if (boundSession) io.to(roleRoom(boundSession, "controller")).emit(SOCKET_EVENTS.TABS_UPDATE, tabs);
		});

		socket.on(SOCKET_EVENTS.REQUEST_TABS, () => {
			if (boundSession) io.to(roleRoom(boundSession, "extension")).emit(SOCKET_EVENTS.REQUEST_TABS);
		});

		socket.on(SOCKET_EVENTS.REQUEST_SCREENSHOT, (payload) => {
			if (boundSession) io.to(roleRoom(boundSession, "extension")).emit(SOCKET_EVENTS.REQUEST_SCREENSHOT, payload);
		});

		socket.on(SOCKET_EVENTS.SCREENSHOT_RESULT, (payload) => {
			if (boundSession) io.to(roleRoom(boundSession, "controller")).emit(SOCKET_EVENTS.SCREENSHOT_RESULT, payload);
		});

		socket.on(SOCKET_EVENTS.PING, () => {
			socket.emit(SOCKET_EVENTS.PONG, { at: Date.now() });
		});

		socket.on("disconnect", () => {
			console.log(`[avalon-relay] disconnect ${socket.id} session=${boundSession?.sessionId ?? "-"}`);
			cleanupSocket(socket);
			if (boundSession) void emitClusterPeerStatus(io, boundSession);
		});
	});

	console.log(
		`[avalon-relay] ready on /avalon/health and /avalon/socket.io (pingInterval=${pingInterval}ms pingTimeout=${pingTimeout}ms)`,
	);
	return io;
}
