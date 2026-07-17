#!/usr/bin/env node
/**
 * Start all NextOffer dev services with plain structured log multiplexing.
 * Set DEV_TUI=1 to opt into the Ink TUI dashboard.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboard = path.join(ROOT, 'scripts', 'dev-dashboard.mjs');

if (process.stdout.isTTY && process.env.DEV_TUI === '1') {
	const runner = spawn(process.execPath, [dashboard], {
		cwd: ROOT,
		stdio: 'inherit',
		env: { ...process.env },
	});
	runner.on('exit', (code) => process.exit(code ?? 0));
} else {
	const { installTerminalLogger } = await import('@nextoffer/shared/terminal-log');
	installTerminalLogger('dev');

	const writeRaw = (line) => process.stdout.write(`${line}\n`);

	const {
		backendServices,
		getDevSummary,
		startService,
		uiService,
		waitForBackends,
	} = await import('./lib/dev-runtime.mjs');

	const children = [];

	function shutdown(code = 0) {
		for (const child of children) {
			if (!child.killed) child.kill('SIGTERM');
		}
		process.exit(code);
	}

	process.on('SIGINT', () => shutdown(0));
	process.on('SIGTERM', () => shutdown(0));

	const onLine = ({ line }) => writeRaw(line);
	const onExit = (name, code) => {
		if (code && code !== 0) {
			console.error(`[dev] ${name} exited with code ${code}`);
			shutdown(code);
		}
	};

	for (const svc of backendServices) {
		children.push(startService(svc, onLine, onExit));
	}

	const waitResult = await waitForBackends();
	if (waitResult.ready) {
		console.log('[dev] backend ports ready');
	} else if (waitResult.pending?.length) {
		console.warn(`[dev] timed out waiting for backends (${waitResult.pending.join(', ')}) — starting UI anyway`);
	}

	children.push(startService(uiService, onLine, onExit));

	const summary = getDevSummary();
	console.log('');
	console.log('NextOffer is running:');
	for (const ep of summary.endpoints) {
		console.log(`  ${ep.label.padEnd(16)} → ${ep.url}`);
	}
	for (const line of summary.networkLines) {
		console.log(`  ${line}`);
	}
	console.log('Press Ctrl+C to stop all services.');
}
