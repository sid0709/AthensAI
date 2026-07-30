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
const RANKING_AUTO_BACKFILL = !['0', 'false', 'no', 'off'].includes(
	String(process.env.RANKING_AUTO_BACKFILL ?? 'true').trim().toLowerCase(),
);

// Every TCP port this project owns: the four backends + the Vite UI dev server.
const DEV_UI_PORT = Number(process.env.VITE_DEV_PORT || 9030);
const PROJECT_PORTS = [...backendPorts.map((p) => p.port), DEV_UI_PORT];

function run(cmd, args, opts = {}) {
	console.log(`> ${cmd} ${args.join(' ')}`);
	const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

async function rankingPointCount() {
	const base = String(process.env.QDRANT_URL || 'http://127.0.0.1:6333').replace(/\/+$/, '');
	const headers = { 'Content-Type': 'application/json' };
	if (process.env.QDRANT_API_KEY) headers['api-key'] = process.env.QDRANT_API_KEY;
	const response = await fetch(`${base}/collections/jobs_active/points/count`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ exact: true }),
		signal: AbortSignal.timeout(5_000),
	});
	if (response.status === 404) return 0;
	if (!response.ok) throw new Error(`Qdrant ranking count failed (${response.status})`);
	const payload = await response.json();
	return Math.max(0, Number(payload?.result?.count || 0));
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

{
	if (process.env.SKIP_DOCKER === '1') {
		const targets = [
			{ host: '127.0.0.1', port: 6379, label: 'Redis' },
			...(QUERY_TIME_RANKING_ENABLED
				? [{ host: '127.0.0.1', port: 6333, label: 'Qdrant' }]
				: []),
		];
		for (const target of targets) {
			if (!(await probe(target.host, target.port))) {
				console.error(`[prestart] ${target.label} is required but is not reachable on ${target.host}:${target.port}`);
				process.exit(1);
			}
		}
	} else {
		const services = QUERY_TIME_RANKING_ENABLED ? ['redis', 'qdrant'] : ['redis'];
		console.log(`[prestart] Starting ${services.join(' + ')} for durable background tasks${QUERY_TIME_RANKING_ENABLED ? ' and query-time ranking' : ''}`);
		run('docker', ['compose', 'up', '-d', '--wait', ...services]);
	}
}

// Local Docker volumes can be brand new while Firestore already contains the
// authoritative job catalog. Production deployment performs this same guard;
// without it Job Search starts successfully with a misleading empty snapshot.
if (QUERY_TIME_RANKING_ENABLED) {
	const indexed = await rankingPointCount();
	if (indexed === 0 && RANKING_AUTO_BACKFILL) {
		console.log('[prestart] Ranking index is empty; indexing authoritative jobs');
		// Skill-dictionary maintenance is independent and can be slow on a shared
		// Firestore project. The ranking bootstrap computes the same stable IDs.
		run(
			'npm',
			['run', 'backfill-query-ranking', '-w', 'Athens-server', '--', '--skip-dictionary'],
			{
				env: {
					...process.env,
					RANKING_BACKFILL_BATCH: process.env.RANKING_BACKFILL_BATCH || '1000',
				},
			},
		);
	} else if (indexed === 0) {
		console.warn('[prestart] Ranking index is empty and RANKING_AUTO_BACKFILL is disabled');
	} else {
		console.log(`[prestart] Ranking index ready (${indexed.toLocaleString()} jobs)`);
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
