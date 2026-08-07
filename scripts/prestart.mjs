#!/usr/bin/env node
/** Validate athens-backend env, clear stale dev ports. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { installTerminalLogger, printBanner } from '@nextoffer/shared/terminal-log';
import { freePorts } from './wait-for-ports.mjs';
import { backendPorts } from './lib/dev-runtime.mjs';

installTerminalLogger('prestart');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: path.join(ROOT, 'athens-backend', '.env') });

printBanner('NextOffer Prestart', ['athens-backend (Nest)', 'Athens SPA']);
await freePorts([...backendPorts.map((port) => port.port), Number(process.env.VITE_DEV_PORT || 9030)]);

for (const name of ['DATABASE_URL', 'API_KEYS_ENCRYPTION_KEY']) {
	if (!String(process.env[name] || '').trim()) {
		console.error(`[prestart] ${name} is required in athens-backend/.env`);
		process.exit(1);
	}
}

if (String(process.env.FIREBASE_PROJECT_ID || '').trim()) {
	console.log(`[prestart] Firebase configured for project ${process.env.FIREBASE_PROJECT_ID}`);
} else {
	console.warn('[prestart] FIREBASE_PROJECT_ID unset — Firebase explorer / Storage features will fail.');
}

const prisma = spawnSync('npm', ['run', 'prisma:generate', '--prefix', 'athens-backend'], {
	stdio: 'inherit',
	cwd: ROOT,
});
if (prisma.status !== 0) {
	console.error('[prestart] prisma generate failed');
	process.exit(prisma.status ?? 1);
}

console.log('[prestart] Bootstrap complete.');
