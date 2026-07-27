#!/usr/bin/env node
/**
 * Bootstrap before `npm start`. Firebase is validated, optional ranking
 * infrastructure is started, then the AI gateway is built.
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

const QUERY_TIME_RANKING_MODE = String(
	process.env.RECOMMENDATION_QUERY_TIME_MODE
		|| (process.env.RECOMMENDATION_QUERY_TIME === 'true' ? 'on' : 'off'),
).trim().toLowerCase();
const QUERY_TIME_RANKING_ENABLED = ['on', 'shadow'].includes(QUERY_TIME_RANKING_MODE);

// Every TCP port this project owns: the four backends + the Vite UI dev server.
const DEV_UI_PORT = Number(process.env.VITE_DEV_PORT || 9030);
const PROJECT_PORTS = [...backendPorts.map((p) => p.port), DEV_UI_PORT];

function run(cmd, args, opts = {}) {
	console.log(`> ${cmd} ${args.join(' ')}`);
	const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

printBanner('NextOffer Prestart', [
	'Firestore backend',
	QUERY_TIME_RANKING_ENABLED
		? `query-time ranking ${QUERY_TIME_RANKING_MODE} — Redis + Qdrant required`
		: 'query-time ranking off — Docker optional',
]);

// Free our own ports first so a stale service from a previous run can't linger
// and cause port-in-use / transient ECONNREFUSED failures on the fresh start.
await freePorts(PROJECT_PORTS);

for (const name of ['FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'GOOGLE_APPLICATION_CREDENTIALS']) {
	if (!String(process.env[name] || '').trim()) {
		console.error(`[prestart] ${name} is required`);
		process.exit(1);
	}
}
console.log(`[prestart] Firestore configured for project ${process.env.FIREBASE_PROJECT_ID}`);

if (QUERY_TIME_RANKING_ENABLED) {
	if (process.env.SKIP_DOCKER === '1') {
		const targets = [
			{ host: '127.0.0.1', port: 6379, label: 'Redis' },
			{ host: '127.0.0.1', port: 6333, label: 'Qdrant' },
		];
		for (const target of targets) {
			if (!(await probe(target.host, target.port))) {
				console.error(`[prestart] ${target.label} is required for query-time ranking but is not reachable on ${target.host}:${target.port}`);
				process.exit(1);
			}
		}
	} else {
		console.log(`[prestart] Query-time ranking is ${QUERY_TIME_RANKING_MODE} — starting Redis + Qdrant`);
		run('docker', ['compose', 'up', '-d', '--wait', 'redis', 'qdrant']);
	}
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
