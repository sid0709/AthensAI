#!/usr/bin/env node
/**
 * Bootstrap before `npm start`. The selected database backend is validated,
 * then the AI gateway is built. No Docker, Redis, or Qdrant is required.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { installTerminalLogger, printBanner } from '@nextoffer/shared/terminal-log';
import { freePorts, probe } from './wait-for-ports.mjs';
import { backendPorts } from './lib/dev-runtime.mjs';

installTerminalLogger('prestart');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: path.join(ROOT, 'Athens-server', '.env') });

const DATABASE_BACKEND = String(process.env.DATABASE_BACKEND || 'mongo').trim().toLowerCase();

const MONGO_HOST = process.env.MONGO_HOST || '127.0.0.1';
const MONGO_PORT = Number(process.env.MONGO_PORT || 27017);

// Every TCP port this project owns: the four backends + the Vite UI dev server.
// (MongoDB is external infra — intentionally excluded so we never kill it.)
const DEV_UI_PORT = Number(process.env.VITE_DEV_PORT || 9030);
const PROJECT_PORTS = [...backendPorts.map((p) => p.port), DEV_UI_PORT];

function run(cmd, args, opts = {}) {
	console.log(`> ${cmd} ${args.join(' ')}`);
	const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

printBanner('NextOffer Prestart', [`${DATABASE_BACKEND} backend — no Docker required`]);

// Free our own ports first so a stale service from a previous run can't linger
// and cause port-in-use / transient ECONNREFUSED failures on the fresh start.
await freePorts(PROJECT_PORTS);

if (DATABASE_BACKEND === 'firestore') {
	for (const name of ['FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'GOOGLE_APPLICATION_CREDENTIALS']) {
		if (!String(process.env[name] || '').trim()) {
			console.error(`[prestart] ${name} is required when DATABASE_BACKEND=firestore`);
			process.exit(1);
		}
	}
	console.log(`[prestart] Firestore configured for project ${process.env.FIREBASE_PROJECT_ID}`);
} else if (DATABASE_BACKEND === 'mongo') {
	if (!(await probe(MONGO_HOST, MONGO_PORT))) {
		console.error(`
[prestart] MongoDB is not reachable at ${MONGO_HOST}:${MONGO_PORT}.

Start a local MongoDB (no Docker needed):
  brew services start mongodb-community
  # or run mongod however you prefer

Then: npm start
`);
		process.exit(1);
	}
	console.log(`[prestart] MongoDB ready on ${MONGO_HOST}:${MONGO_PORT}`);
} else {
	console.error(`[prestart] Unsupported DATABASE_BACKEND=${DATABASE_BACKEND}; use firestore or mongo`);
	process.exit(1);
}

// Ensure Puppeteer's bundled Chrome is present for résumé PDF rendering.
// Skips download when already cached; does not use system Chrome.
{
	const chrome = spawnSync('npm', ['run', 'install:chrome', '-w', 'Athens-server'], {
		stdio: 'inherit',
		cwd: ROOT,
	});
	if (chrome.status !== 0) {
		console.warn(`
[prestart] Puppeteer Chrome for Testing is not installed.
Résumé PDF rendering will fail until you run:
  npm run install:chrome -w Athens-server
`);
	}
}

// Build the AI BFF gateway that all LLM calls route through.
run('npm', ['run', 'build', '-w', 'ai-bff']);

console.log('[prestart] Bootstrap complete.');
