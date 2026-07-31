import "dotenv/config";

import cluster from "node:cluster";
import os from "node:os";
import http from "node:http";

import { installTerminalLogger, requestLogger } from "@nextoffer/shared/terminal-log";
installTerminalLogger("athens");

import express from "express";
import cors from "cors";

import { initDataStore, closeDataStore, getDataStore } from "./src/db/dataStore.js";
import { initRedis, closeRedis, isRedisReady } from "./src/db/redis.js";
import { loadCanonicalSkillDictionary } from "./src/services/matching/canonicalSkillDictionary.js";
import {
	closeExtensionScraperSocket,
	initExtensionScraperSocket,
} from "./src/services/extensionScraperSocket.js";
import { startMatchScoreWorker, stopMatchScoreWorker } from "./src/services/matching/matchScoreWorker.js";
import { startLocalSearchOutboxWorker, stopLocalSearchOutboxWorker } from "./src/services/search/localOutboxWorker.js";
import { startJobStatusOutboxWorker, stopJobStatusOutboxWorker } from "./src/services/jobStatusOutboxWorker.js";
import { shutdownPool as shutdownImapPool } from "./src/services/mail/imapPool.js";
import { shutdownPdfPool } from "./src/services/pdf/pdfRenderPool.js";
import statusRoutes from "./src/routes/statusRoutes.js";
import statusAdminRoutes from "./src/routes/statusAdminRoutes.js";
import {
	metricsMiddleware,
	renderMetrics,
	startAggregateMetricsServer,
	startEventLoopDelayMetrics,
	stopAggregateMetricsServer,
} from "./src/services/monitoring/metrics.js";
import { startMonitoringLoop } from "./src/services/monitoring/monitorLoop.js";
import { markForegroundActivity } from "./src/services/runtimeLoad.js";
import { initJobRankingCollection, initQdrantCollections } from "./src/services/vectorStore/qdrantClient.js";
import {
	isQueryTimeRankingEnabled,
	isQueryTimeRankingIndexEnabled,
} from "./src/config/graphAndVectorConfig.js";
import { shutdownRankingPool, warmRankingPool } from "./src/services/matching/exactRerankPool.js";
import { cleanupExistingJobIdentityDuplicates } from "./src/services/jobIdentityCleanup.js";
import {
	getJobListReadModelState,
	initJobListCatalogSnapshot,
	initJobListReadModel,
	isJobListV2Enabled,
} from "./src/services/jobListReadModelService.js";
import { warmTitleReviewReadCache } from "./src/services/jobTitleReview/titleReviewSession.js";

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
import notionRoutes from "./src/routes/notionRoutes.js";
import agentRoutes from "./src/routes/agentRoutes.js";
import scrapedJobIngestRoutes from "./src/routes/scrapedJobIngestRoutes.js";
import aiUsageRoutes from "./src/routes/aiUsageRoutes.js";
import firebaseRoutes from "./src/routes/firebaseRoutes.js";
import bidResultsRoutes from "./src/routes/bidResultsRoutes.js";
import jobAnalyzeRoutes from "./src/routes/jobAnalyzeRoutes.js";
import backgroundTaskRoutes from "./src/routes/backgroundTaskRoutes.js";
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

const startupProgressIntervalMs = Math.max(
	1_000,
	Number.parseInt(String(process.env.STARTUP_PROGRESS_INTERVAL_MS || "10000"), 10) || 10_000,
);

function formatStartupDuration(milliseconds) {
	if (milliseconds < 1_000) return `${Math.max(0, Math.round(milliseconds))}ms`;
	const seconds = milliseconds / 1_000;
	return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

async function runStartupStep(label, operation) {
	const startedAt = Date.now();
	console.log(`[startup] ${label} started`);
	const progress = setInterval(() => {
		console.log(`[startup] ${label} still running (${formatStartupDuration(Date.now() - startedAt)})`);
	}, startupProgressIntervalMs);
	progress.unref?.();
	try {
		const result = await operation();
		console.log(`[startup] ${label} finished (${formatStartupDuration(Date.now() - startedAt)})`);
		return result;
	} catch (error) {
		console.error(
			`[startup] ${label} failed after ${formatStartupDuration(Date.now() - startedAt)}:`,
			error?.message || error,
		);
		throw error;
	} finally {
		clearInterval(progress);
	}
}

function isCompanyGroupingEnabled() {
	return !["0", "false", "no", "off"].includes(
		String(process.env.JOB_COMPANY_GROUPING_ENABLED ?? "true").trim().toLowerCase(),
	);
}

async function cleanupHistoricalJobDuplicates() {
	const result = await cleanupExistingJobIdentityDuplicates();
	if (!result.alreadyComplete) {
		console.log(
			`[job-identity] historical cleanup scanned=${result.scanned || 0} ` +
			`kept=${result.kept || 0} removed=${result.removed || 0}`,
		);
	}
}

function createApp() {
	const app = express();
	app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || (process.env.NODE_ENV === "production" ? "10mb" : "100mb") }));
	const corsOrigins = String(process.env.CORS_ORIGIN || "*").split(",").map((value) => value.trim()).filter(Boolean);
	app.use(cors({ origin: corsOrigins.includes("*") ? true : corsOrigins, credentials: false }));
	app.use(requestLogger("api"));
	app.use(metricsMiddleware);
	app.use((req, _res, next) => {
		if (req.path !== "/healthz" && req.path !== "/readyz" && req.path !== "/metrics") markForegroundActivity();
		next();
	});
	// Production metrics are available only on the private cluster-wide
	// listener (:9101) attached to the monitoring Docker network.
	if (process.env.NODE_ENV !== "production" || process.env.LEGACY_METRICS_ENDPOINT === "true") {
		app.get("/metrics", (_req, res) => {
			res.type("text/plain; version=0.0.4").send(renderMetrics("athens-server"));
		});
	}

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
		if (!databaseReady || !getDataStore()) return res.status(503).json({ ok: false, databaseReady: false });
		try {
			await getDataStore().command({ ping: 1 });
			const jobListReadModel = getJobListReadModelState();
			if (jobListReadModel.enabled && !jobListReadModel.ready) {
				return res.status(503).json({ ok: false, databaseReady: true, jobListReadModel });
			}
			return res.json({ ok: true, databaseReady: true, jobListReadModel });
		} catch {
			return res.status(503).json({ ok: false, databaseReady: false, error: "database unavailable" });
		}
	});
	app.use((req, res, next) => {
		if (databaseReady) return next();
		// Startup probes and UI retries are expected while maintenance finishes.
		// The startup lifecycle log is actionable; one error per request is not.
		res.locals.suppressRequestLog = true;
		return res.status(503).json({
			success: false,
			retryable: true,
			error: "Athens-server is finishing startup maintenance",
		});
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
	app.use("/api", notionRoutes);
	app.use("/api/agents", agentRoutes);
	app.use("/api", scrapedJobIngestRoutes);
	app.use("/api", aiUsageRoutes);
	app.use("/api", firebaseRoutes);
	app.use("/api", bidResultsRoutes);
	app.use("/api", jobAnalyzeRoutes);
	app.use("/api", backgroundTaskRoutes);
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
	const startupStartedAt = Date.now();
	await runStartupStep("Firestore connection and job-identity maintenance", () => initDataStore());
	const rankingIndexNeeded = isQueryTimeRankingIndexEnabled() || isCompanyGroupingEnabled() || isJobListV2Enabled();
	await runStartupStep("Redis connection", () => initRedis({ force: true }));
	if (rankingIndexNeeded) {
		await runStartupStep("Qdrant collections", () => initQdrantCollections());
		await runStartupStep("Qdrant ranking indexes", () => initJobRankingCollection());
	}
	if (isJobListV2Enabled()) {
		await runStartupStep("Job-list catalog snapshot", () => initJobListCatalogSnapshot());
	}
	databaseReady = true;
	console.log(`[startup] background services ready (${formatStartupDuration(Date.now() - startupStartedAt)} total)`);
	void cleanupHistoricalJobDuplicates().catch((error) => {
		console.error("[job-identity] historical cleanup failed:", error?.message || error);
	});
	if (process.env.BACKGROUND_WORKERS_MODE !== "tasks") {
		if (!isQueryTimeRankingEnabled()) startMatchScoreWorker();
		startLocalSearchOutboxWorker();
		startJobStatusOutboxWorker();
	}
	console.log(`[athens] primary background workers started (pid ${process.pid})`);
}

async function startHttpWorker({ clustered }) {
	const startupStartedAt = Date.now();
	const stopEventLoopMetrics = startEventLoopDelayMetrics({ role: "web" });
	const app = createApp();
	const server = http.createServer(app);
	initExtensionScraperSocket(server);
	server.on("error", (err) => {
		console.error(`[athens] listen error:`, err.message);
		process.exit(1);
	});
	server.listen(port, host, () => {
		console.log(`Server running on http://${host}:${port} (pid ${process.pid})`);
		console.log("[startup] health checks are available; API requests return 503 until maintenance finishes");
		if (!clustered) {
			console.log(`Avalon relay is a separate process (default :3847) — see @avalon/backend`);
		}
	});

	await runStartupStep("Firestore connection and job-identity maintenance", () => initDataStore());
	const needsJobRankingIndex = isQueryTimeRankingIndexEnabled() || isJobListV2Enabled();
	await runStartupStep("Redis connection", () => initRedis({ force: true }));
	if (needsJobRankingIndex) {
		await runStartupStep("Qdrant collections", () => initQdrantCollections());
		const rankingReady = await runStartupStep("Qdrant ranking indexes", () => initJobRankingCollection());
		if (rankingReady && isRedisReady()) {
			await runStartupStep("Canonical skill dictionary", () => loadCanonicalSkillDictionary());
			await runStartupStep("Ranking worker pool", () => warmRankingPool());
		}
	}
	if (isJobListV2Enabled()) {
		await runStartupStep("Job-list read model and profile caches", () => initJobListReadModel());
	}
	await runStartupStep("Title-review first-page cache", () => warmTitleReviewReadCache());
	databaseReady = true;
	console.log(`[startup] API ready (${formatStartupDuration(Date.now() - startupStartedAt)} total)`);
	if (!clustered) {
		startAggregateMetricsServer();
		void cleanupHistoricalJobDuplicates().catch((error) => {
			console.error("[job-identity] historical cleanup failed:", error?.message || error);
		});
	}
	if (!clustered && process.env.BACKGROUND_WORKERS_MODE !== "tasks") startMonitoringLoop();

	let shuttingDown = false;
	async function shutdown(signal) {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`[athens] worker ${process.pid} ${signal} — graceful shutdown`);
		const force = setTimeout(() => process.exit(1), 15_000);
		force.unref?.();
		try {
			stopEventLoopMetrics();
			await closeExtensionScraperSocket();
			if (!clustered) {
				stopMatchScoreWorker();
				stopLocalSearchOutboxWorker();
				stopJobStatusOutboxWorker();
			}
			if (server.listening) await new Promise((resolve) => server.close(() => resolve()));
			await shutdownPdfPool();
			await shutdownImapPool();
			await shutdownRankingPool();
			if (!clustered) await stopAggregateMetricsServer();
			await closeRedis();
			await closeDataStore();
		} catch (err) {
			console.error(`[athens] worker shutdown error:`, err.message);
		}
		clearTimeout(force);
		process.exit(0);
	}
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	if (!clustered) return;

	// Node's cluster module shares the HTTP listener across workers.
	console.log(`[athens] cluster worker ready (pid ${process.pid})`);
}

async function startPrimary() {
	startAggregateMetricsServer();
	let shuttingDown = false;

	cluster.on("exit", (worker, code, signal) => {
		if (shuttingDown) return;
		console.warn(
			`[athens] worker ${worker.process.pid} exited (code=${code} signal=${signal}) — respawning`,
		);
		cluster.fork();
	});

	await startBackgroundWorkers();
	for (let i = 0; i < workerCount; i += 1) {
		cluster.fork();
	}
	console.log(`[athens] cluster primary started HTTP workers (workers=${workerCount})`);
	console.log(`Avalon relay is a separate process (default :3847) — see @avalon/backend`);
	if (process.env.BACKGROUND_WORKERS_MODE !== "tasks") startMonitoringLoop();

	async function shutdown(signal) {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`[athens] primary ${signal} — stopping workers`);
		stopMatchScoreWorker();
		stopLocalSearchOutboxWorker();
		stopJobStatusOutboxWorker();
		for (const id of Object.keys(cluster.workers || {})) {
			cluster.workers[id]?.process.kill("SIGTERM");
		}
		const force = setTimeout(() => process.exit(1), 20_000);
		force.unref?.();
		try {
			await shutdownImapPool();
			await stopAggregateMetricsServer();
			await closeRedis();
			await closeDataStore();
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
			if (!isQueryTimeRankingEnabled()) startMatchScoreWorker();
			startLocalSearchOutboxWorker();
			startJobStatusOutboxWorker();
		}
	}
}

main().catch((err) => {
	console.error("Failed to start server", err);
	process.exit(1);
});
