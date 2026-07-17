/**
 * Avalon Socket.IO relay — merged from project-avalon/packages/backend.
 * Serves HTTP under /avalon/* and Socket.IO on path /avalon/socket.io
 * alongside the legacy Athens socketHub on /socket.io.
 */

import { Server } from "socket.io";
import {
	DEFAULT_SESSION_ID,
	SOCKET_EVENTS,
} from "@avalon/shared";

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
	return raw.trim() || "*";
}

/**
 * Mount Avalon HTTP routes (call before the catch-all 404).
 * @param {import('express').Express} app
 */
export function mountAvalonRelayRoutes(app) {
	app.get("/avalon/health", (_req, res) => {
		const active = listSessions();
		res.json({ ok: true, sessions: sessions.size, active });
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
export function initAvalonRelay(httpServer) {
	const corsOrigin = parseCorsOrigin();

	const io = new Server(httpServer, {
		path: "/avalon/socket.io",
		cors: { origin: corsOrigin === "*" ? true : corsOrigin },
	});

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
			console.log(
				`[avalon-relay] register profile=${session.profileId} session=${session.sessionId} role=${payload?.role} client=${socket.id}`,
			);
		});

		socket.on(SOCKET_EVENTS.EXECUTE_ACTION, (action) => {
			if (!boundSession?.extension) {
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
			boundSession.extension.emit(SOCKET_EVENTS.EXECUTE_ACTION, action);
		});

		socket.on(SOCKET_EVENTS.ACTION_RESULT, (result) => {
			console.log(
				`[avalon-relay] action-result ← session=${boundSession?.sessionId ?? "-"} id=${result?.actionId} success=${result?.success}`,
			);
			boundSession?.controller?.emit(SOCKET_EVENTS.ACTION_RESULT, result);
		});

		socket.on(SOCKET_EVENTS.APPLY_PROGRESS, (progress) => {
			if (!boundSession) return;
			console.log(
				`[avalon-relay] apply-progress session=${boundSession.sessionId} phase=${progress?.phase}`,
			);
			boundSession.controller?.emit(SOCKET_EVENTS.APPLY_PROGRESS, progress);
			for (const observer of boundSession.observers) {
				observer.emit(SOCKET_EVENTS.APPLY_PROGRESS, progress);
			}
		});

		socket.on(SOCKET_EVENTS.TABS_UPDATE, (tabs) => {
			boundSession?.controller?.emit(SOCKET_EVENTS.TABS_UPDATE, tabs);
		});

		socket.on(SOCKET_EVENTS.REQUEST_TABS, () => {
			boundSession?.extension?.emit(SOCKET_EVENTS.REQUEST_TABS);
		});

		socket.on(SOCKET_EVENTS.REQUEST_SCREENSHOT, (payload) => {
			boundSession?.extension?.emit(SOCKET_EVENTS.REQUEST_SCREENSHOT, payload);
		});

		socket.on(SOCKET_EVENTS.SCREENSHOT_RESULT, (payload) => {
			boundSession?.controller?.emit(SOCKET_EVENTS.SCREENSHOT_RESULT, payload);
		});

		socket.on(SOCKET_EVENTS.PING, () => {
			socket.emit(SOCKET_EVENTS.PONG, { at: Date.now() });
		});

		socket.on("disconnect", () => {
			console.log(`[avalon-relay] disconnect ${socket.id} session=${boundSession?.sessionId ?? "-"}`);
			cleanupSocket(socket);
		});
	});

	console.log("[avalon-relay] ready on /avalon/health and /avalon/socket.io");
	return io;
}
