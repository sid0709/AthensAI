import dotenv from "dotenv";
dotenv.config();

import cluster from "node:cluster";
import os from "node:os";
import http from "node:http";

import { installTerminalLogger, requestLogger } from "@nextoffer/shared/terminal-log";
installTerminalLogger("athens");

import express from "express";
import cors from "cors";
import { setupMaster } from "@socket.io/sticky";
import { setupPrimary } from "@socket.io/cluster-adapter";

import { initMongo, closeMongo, getMongoDb } from "./src/db/mongo.js";
import { initSocket, closeSocket } from "./src/socketHub.js";
import { startJobAnalysisWorker, stopJobAnalysisWorker } from "./src/services/jobAnalysis/index.js";
import { startMatchScoreWorker, stopMatchScoreWorker } from "./src/services/matching/matchScoreWorker.js";
import { startLocalSearchOutboxWorker, stopLocalSearchOutboxWorker } from "./src/services/search/localOutboxWorker.js";
import { shutdownPool as shutdownImapPool } from "./src/services/mail/imapPool.js";
import { shutdownPdfPool } from "./src/services/pdf/pdfRenderPool.js";
import statusRoutes from "./src/routes/statusRoutes.js";
import statusAdminRoutes from "./src/routes/statusAdminRoutes.js";
import { metricsMiddleware, renderMetrics } from "./src/services/monitoring/metrics.js";
import { startMonitoringLoop } from "./src/services/monitoring/monitorLoop.js";

import openTabsRoutes from "./src/routes/openTabsRoutes.js";
import jobRoutes from "./src/routes/jobRoutes.js";
import personalInfoRoutes from "./src/routes/personalInfoRoutes.js";
import skillCategoryRoutes from "./src/routes/skillCategoryRoutes.js";
import reportRoutes from "./src/routes/reportRoutes.js";
import accountInfoRoutes from "./src/routes/accountInfoRoutes.js";
import foxRoutes from "./src/routes/foxRoutes.js";
import ruleRoutes from "./src/routes/ruleRoutes.js";
import vendorMonitorRoutes from "./src/routes/vendorMonitorRoutes.js";
import mailRoutes from "./src/routes/mailRoutes.js";
import settingsRoutes from "./src/routes/settingsRoutes.js";
import agentRoutes from "./src/routes/agentRoutes.js";
import scrapedJobIngestRoutes from "./src/routes/scrapedJobIngestRoutes.js";
import aiUsageRoutes from "./src/routes/aiUsageRoutes.js";
import backupRoutes from "./src/routes/backupRoutes.js";
import firebaseRoutes from "./src/routes/firebaseRoutes.js";
import bidResultsRoutes from "./src/routes/bidResultsRoutes.js";
import jobAnalyzeRoutes from "./src/routes/jobAnalyzeRoutes.js";
import { errorHandler } from "./src/middleware/errorHandler.js";
import { requireFirebaseAuth } from "./src/middleware/firebaseAuth.js";
import internalTaskRoutes from "./src/routes/internalTaskRoutes.js";
import { requireWritesEnabled } from "./src/middleware/writeGate.js";
import { requireRoleScope } from "./src/middleware/roleScope.js";
import {
	getAutoBidProfile,
	upsertAutoBidProfile,
	getResumeCatalog,
	upsertResumeCatalog,
	validateResumeCatalogHandler,
} from "./src/controllers/personalInfoController.js";

const port = Number.parseInt(String(process.env.PORT || "8979"), 10) || 8979;
const host = process.env.HOST !== undefined && process.env.HOST !== "" ? process.env.HOST : "0.0.0.0";

function resolveWorkerCount() {
	const raw = String(process.env.WEB_CONCURRENCY ?? "").trim();
	if (raw === "1") return 1;
	const n = Number.parseInt(raw, 10);
	if (Number.isFinite(n) && n > 0) return n;
	// Production (Docker/supervisord): use all cores. Local nodemon: single process unless set.
	if (process.env.NODE_ENV === "production") {
		return Math.max(1, os.cpus().length);
	}
	return 1;
}

const workerCount = resolveWorkerCount();
const useCluster = workerCount > 1;

let databaseReady = false;

function createApp() {
	const app = express();
	app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || (process.env.NODE_ENV === "production" ? "10mb" : "100mb") }));
	const corsOrigins = String(process.env.CORS_ORIGIN || "*").split(",").map((value) => value.trim()).filter(Boolean);
	app.use(cors({ origin: corsOrigins.includes("*") ? true : corsOrigins, credentials: false }));
	app.use(requestLogger("api"));
	app.use(metricsMiddleware);
	app.get("/metrics", (_req, res) => {
		res.type("text/plain; version=0.0.4").send(renderMetrics("athens-server"));
	});

	app.get("/healthz", (_req, res) => {
		res.json({
			ok: true,
			service: "athens-server",
			pid: process.pid,
			worker: Boolean(cluster.isWorker),
			databaseReady,
		});
	});

	app.get("/readyz", async (_req, res) => {
		if (!databaseReady || !getMongoDb()) return res.status(503).json({ ok: false, databaseReady: false });
		try {
			await getMongoDb().command({ ping: 1 });
			return res.json({ ok: true, databaseReady: true });
		} catch {
			return res.status(503).json({ ok: false, databaseReady: false, error: "database unavailable" });
		}
	});
	app.use("/internal/tasks", internalTaskRoutes);

	app.use(requireFirebaseAuth);
	app.use(requireRoleScope);
	app.use(requireWritesEnabled);

	app.use("/api", openTabsRoutes);
	app.use("/api", jobRoutes);
	app.use("/api", personalInfoRoutes);
	app.use("/api", skillCategoryRoutes);
	app.use("/api", reportRoutes);
	app.use("/api", accountInfoRoutes);
	app.use("/api", foxRoutes);
	app.use("/api", ruleRoutes);
	app.use("/api", vendorMonitorRoutes);
	app.use("/api", mailRoutes);
	app.use("/api", settingsRoutes);
	app.use("/api/agents", agentRoutes);
	app.use("/api", scrapedJobIngestRoutes);
	app.use("/api", aiUsageRoutes);
	app.use("/api", backupRoutes);
	app.use("/api", firebaseRoutes);
	app.use("/api", bidResultsRoutes);
	app.use("/api", jobAnalyzeRoutes);
	app.use("/api", statusRoutes);
	app.use("/api", statusAdminRoutes);

	app.get("/personal/auto-bid-profile", getAutoBidProfile);
	app.put("/personal/auto-bid-profile", upsertAutoBidProfile);
	app.get("/personal/resume-catalog", getResumeCatalog);
	app.put("/personal/resume-catalog", upsertResumeCatalog);
	app.post("/personal/resume-catalog/validate", validateResumeCatalogHandler);

	app.use(errorHandler);

	app.use((req, res) => {
		if (req.originalUrl.startsWith("/api") || req.originalUrl.startsWith("/personal")) {
			return res.status(404).json({
				success: false,
				error: "API route not found",
				path: req.originalUrl,
			});
		}
		res.status(404).type("text/plain").send("Not found");
	});

	return app;
}

async function startBackgroundWorkers() {
	await initMongo();
	databaseReady = true;
	if (process.env.BACKGROUND_WORKERS_MODE !== "tasks") {
		startJobAnalysisWorker();
		startMatchScoreWorker();
		startLocalSearchOutboxWorker();
	}
	console.log(`[athens] primary background workers started (pid ${process.pid})`);
}

async function startHttpWorker({ clustered }) {
	await initMongo();
	databaseReady = true;
	if (!clustered && process.env.BACKGROUND_WORKERS_MODE !== "tasks") startMonitoringLoop();

	const app = createApp();
	const server = http.createServer(app);
	await initSocket(server, { clustered });

	let shuttingDown = false;
	async function shutdown(signal) {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`[athens] worker ${process.pid} ${signal} — graceful shutdown`);
		const force = setTimeout(() => process.exit(1), 15_000);
		force.unref?.();
		try {
			await closeSocket();
			if (!clustered) {
				stopJobAnalysisWorker();
				stopMatchScoreWorker();
				stopLocalSearchOutboxWorker();
				await new Promise((resolve) => server.close(() => resolve()));
			}
			await shutdownPdfPool();
			await shutdownImapPool();
			await closeMongo();
		} catch (err) {
			console.error(`[athens] worker shutdown error:`, err.message);
		}
		clearTimeout(force);
		process.exit(0);
	}
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	if (!clustered) {
		server.on("error", (err) => {
			console.error(`[athens] listen error:`, err.message);
			process.exit(1);
		});
		server.listen(port, host, () => {
			console.log(`Server running on http://${host}:${port} (pid ${process.pid})`);
			console.log(`Socket.IO on ws://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
			console.log(`Avalon relay is a separate process (default :3847) — see @avalon/backend`);
		});
		return;
	}

	// Sticky worker: the primary owns the listen socket; workers receive handed-off connections.
	console.log(`[athens] cluster worker ready (pid ${process.pid})`);
}

async function startPrimary() {
	const httpServer = http.createServer();
	setupMaster(httpServer, {
		loadBalancingMethod: "least-connection",
	});
	setupPrimary();

	httpServer.listen(port, host, () => {
		console.log(`[athens] cluster primary listening on http://${host}:${port} (workers=${workerCount})`);
		console.log(`Avalon relay is a separate process (default :3847) — see @avalon/backend`);
	});

	for (let i = 0; i < workerCount; i += 1) {
		cluster.fork();
	}

	cluster.on("exit", (worker, code, signal) => {
		console.warn(
			`[athens] worker ${worker.process.pid} exited (code=${code} signal=${signal}) — respawning`,
		);
		cluster.fork();
	});

	await startBackgroundWorkers();
	if (process.env.BACKGROUND_WORKERS_MODE !== "tasks") startMonitoringLoop();

	let shuttingDown = false;
	async function shutdown(signal) {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`[athens] primary ${signal} — stopping workers`);
		stopJobAnalysisWorker();
		stopMatchScoreWorker();
		stopLocalSearchOutboxWorker();
		for (const id of Object.keys(cluster.workers || {})) {
			cluster.workers[id]?.process.kill("SIGTERM");
		}
		const force = setTimeout(() => process.exit(1), 20_000);
		force.unref?.();
		try {
			await shutdownImapPool();
			await closeMongo();
			await new Promise((resolve) => httpServer.close(() => resolve()));
		} catch (err) {
			console.error(`[athens] primary shutdown error:`, err.message);
		}
		clearTimeout(force);
		process.exit(0);
	}
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));
}

async function main() {
	if (useCluster && cluster.isPrimary) {
		await startPrimary();
		return;
	}
	// Single-process mode, or a cluster worker.
	const clustered = useCluster && cluster.isWorker;
	await startHttpWorker({ clustered });
	if (!clustered) {
		// Single process also owns background workers (cluster primary runs them instead).
		if (process.env.BACKGROUND_WORKERS_MODE !== "tasks") {
			startJobAnalysisWorker();
			startMatchScoreWorker();
			startLocalSearchOutboxWorker();
		}
	}
}

main().catch((err) => {
	console.error("Failed to start server", err);
	process.exit(1);
});
