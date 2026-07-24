/**
 * Standalone Avalon relay server.
 * Isolated from Athens-server so résumé/PDF batch work cannot starve WebSocket heartbeats.
 *
 * Env:
 *   AVALON_PORT / PORT  (default 3847)
 *   HOST                (default 0.0.0.0)
 *   AVALON_CORS_ORIGIN / CORS_ORIGIN
 *   AVALON_PING_INTERVAL_MS (default 25000)
 *   AVALON_PING_TIMEOUT_MS  (default 60000)
 */

import http from "node:http";
import express from "express";
import cors from "cors";
import { mountAvalonRelayRoutes, initAvalonRelay } from "./avalonRelay.js";

const port = Number.parseInt(String(process.env.AVALON_PORT || process.env.PORT || "3847"), 10) || 3847;
const host = process.env.HOST !== undefined && process.env.HOST !== "" ? process.env.HOST : "0.0.0.0";

function corsOrigins() {
	const raw = String(process.env.AVALON_CORS_ORIGIN || process.env.CORS_ORIGIN || "*").trim();
	if (!raw || raw === "*" || raw.split(",").some((value) => value.trim() === "*")) return true;
	return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

const app = express();
app.use(cors({ origin: corsOrigins() }));
app.use(express.json({ limit: "10mb" }));

mountAvalonRelayRoutes(app);

app.get("/healthz", (_req, res) => {
	res.json({ ok: true, service: "avalon-relay" });
});

app.use((req, res) => {
	res.status(404).json({
		ok: false,
		error: "Not found",
		path: req.originalUrl,
	});
});

const server = http.createServer(app);
const io = await initAvalonRelay(server);

let shuttingDown = false;

async function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[avalon-relay] ${signal} — graceful shutdown`);

	const forceTimer = setTimeout(() => {
		console.error("[avalon-relay] forced exit after drain timeout");
		process.exit(1);
	}, 10_000);
	forceTimer.unref?.();

	try {
		io.close();
		await Promise.all((io.redisClients || []).map((client) => client.quit().catch(() => undefined)));
	} catch {
		/* ignore */
	}

	server.close((err) => {
		clearTimeout(forceTimer);
		if (err) {
			console.error("[avalon-relay] server.close error:", err.message);
			process.exit(1);
		}
		console.log("[avalon-relay] stopped");
		process.exit(0);
	});
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

server.listen(port, host, () => {
	console.log(`[avalon-relay] listening on http://${host}:${port}`);
	console.log(`[avalon-relay] health → http://${host === "0.0.0.0" ? "localhost" : host}:${port}/avalon/health`);
});
