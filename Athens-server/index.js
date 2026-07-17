import dotenv from "dotenv";
dotenv.config();

import { installTerminalLogger, requestLogger } from "@nextoffer/shared/terminal-log";
installTerminalLogger("athens");

import http from "http";
import express from "express";
import cors from 'cors';

import { initMongo } from "./src/db/mongo.js";
import { initSocket } from "./src/socketHub.js";
import { mountAvalonRelayRoutes, initAvalonRelay } from "./src/avalonRelay.js";
import { startJobAnalysisWorker } from "./src/services/jobAnalysis/index.js";
import { startMatchScoreWorker } from "./src/services/matching/matchScoreWorker.js";

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
import firebaseRoutes from "./src/routes/firebaseRoutes.js";
import bidResultsRoutes from "./src/routes/bidResultsRoutes.js";
import jobAnalyzeRoutes from "./src/routes/jobAnalyzeRoutes.js";
import { errorHandler } from "./src/middleware/errorHandler.js";
import {
	getAutoBidProfile,
	upsertAutoBidProfile,
	getResumeCatalog,
	upsertResumeCatalog,
	validateResumeCatalogHandler,
} from "./src/controllers/personalInfoController.js";

const app = express();
const port = Number.parseInt(String(process.env.PORT || "8979"), 10) || 8979;
const host = process.env.HOST !== undefined && process.env.HOST !== "" ? process.env.HOST : "0.0.0.0";

app.use(express.json({ limit: '120mb' }));
app.use(cors({ origin: '*' }));
app.use(requestLogger('api'));

async function bootstrap() {
	// Mongo-only startup — no Redis/Qdrant/Ollama/Docker. Matching is served from
	// the materialized job_match_scores collection; skills come from AI extraction.
	await initMongo();
	startJobAnalysisWorker();
	startMatchScoreWorker();
}

bootstrap().catch(err => {
	console.error('Failed to start server', err);
	process.exit(1);
});

app.use('/api', openTabsRoutes);
app.use('/api', jobRoutes);
app.use('/api', personalInfoRoutes);
app.use('/api', skillCategoryRoutes);
app.use('/api', reportRoutes);
app.use('/api', accountInfoRoutes);
app.use('/api', foxRoutes);
app.use('/api', ruleRoutes);
app.use('/api', vendorMonitorRoutes);
app.use('/api', mailRoutes);
app.use('/api', settingsRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api', scrapedJobIngestRoutes);
app.use('/api', aiUsageRoutes);
app.use('/api', firebaseRoutes);
app.use('/api', bidResultsRoutes);
app.use('/api', jobAnalyzeRoutes);

mountAvalonRelayRoutes(app);

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

const server = http.createServer(app);
initSocket(server);
initAvalonRelay(server);

server.listen(port, host, () => {
	console.log(`Server running on http://${host}:${port}`);
	console.log(`Socket.IO on ws://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
	console.log(`Avalon relay on /avalon/health and /avalon/socket.io`);
});
