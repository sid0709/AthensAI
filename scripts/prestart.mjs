#!/usr/bin/env node
/** Validate Firestore configuration, clear stale dev ports and build the AI gateway. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { installTerminalLogger, printBanner } from '@nextoffer/shared/terminal-log';
import { freePorts } from './wait-for-ports.mjs';
import { backendPorts } from './lib/dev-runtime.mjs';

installTerminalLogger('prestart');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: path.join(ROOT, 'Athens-server', '.env') });

function run(cmd, args, opts = {}) {
	console.log(`> ${cmd} ${args.join(' ')}`);
	const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

printBanner('NextOffer Prestart', ['Firestore authoritative storage', 'Algolia full-text search']);
await freePorts([...backendPorts.map((port) => port.port), Number(process.env.VITE_DEV_PORT || 9030)]);

for (const name of ['FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'GOOGLE_APPLICATION_CREDENTIALS']) {
	if (!String(process.env[name] || '').trim()) {
		console.error(`[prestart] ${name} is required`);
		process.exit(1);
	}
}
console.log(`[prestart] Firestore configured for project ${process.env.FIREBASE_PROJECT_ID}`);

const chrome = spawnSync('npm', ['run', 'install:chrome', '-w', 'Athens-server'], {
	stdio: 'inherit',
	cwd: ROOT,
});
if (chrome.status !== 0) console.warn('[prestart] Puppeteer Chrome is not installed; PDF rendering will be unavailable.');

run('npm', ['run', 'build', '-w', 'ai-bff']);
console.log('[prestart] Bootstrap complete.');

