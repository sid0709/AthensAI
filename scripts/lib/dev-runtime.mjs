/**
 * Shared dev orchestration — spawn services, probe ports, shutdown.
 * athens-backend + Athens UI only (Phase 5 cutover).
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe } from '../wait-for-ports.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const ROOT_DIR = ROOT;

export const backendServices = [
	{
		name: 'athens-backend',
		label: 'athens-backend',
		cmd: 'npm',
		args: ['run', 'start:dev', '--prefix', 'athens-backend'],
		cwd: ROOT,
	},
];

export const uiService = {
	name: 'athens-ui',
	label: 'Athens UI',
	cmd: 'npm',
	args: ['run', 'dev'],
	cwd: path.join(ROOT, 'Athens'),
};

export const backendPorts = [
	{
		host: '127.0.0.1',
		port: Number(process.env.ATHENS_BACKEND_PORT || process.env.PORT || 8980),
		label: 'athens-backend',
		service: 'athens-backend',
	},
];

export function lanAddresses() {
	const ips = new Set();
	for (const nets of Object.values(os.networkInterfaces())) {
		for (const net of nets ?? []) {
			if (net.family === 'IPv4' && !net.internal) ips.add(net.address);
		}
	}
	return [...ips];
}

export function getDevSummary() {
	const devPort = Number(process.env.VITE_DEV_PORT || 9030) || 9030;
	const apiPort = Number(process.env.ATHENS_BACKEND_PORT || process.env.PORT || 8980);
	const networkLines = lanAddresses().map((ip) => `Frontend (LAN) → http://${ip}:${devPort}`);
	return {
		devPort,
		networkLines,
		endpoints: [
			{ label: 'Frontend', url: `http://localhost:${devPort}` },
			{ label: 'athens-backend', url: `http://localhost:${apiPort}` },
		],
	};
}

/**
 * @param {import('node:child_process').ChildProcess} child
 */
export function wireChildOutput(child, serviceName, onLine) {
	const handleChunk = (chunk) => {
		const text = chunk.toString();
		for (const line of text.split(/\r?\n/)) {
			if (!line.trim()) continue;
			onLine({ service: serviceName, line, at: Date.now() });
		}
	};
	child.stdout?.on('data', handleChunk);
	child.stderr?.on('data', handleChunk);
}

/**
 * @param {typeof backendServices[number]} svc
 * @param {(entry: { service: string, line: string, at: number }) => void} onLine
 * @param {(name: string, code: number | null) => void} onExit
 */
export function startService(svc, onLine, onExit) {
	const child = spawn(svc.cmd, svc.args, {
		cwd: svc.cwd,
		stdio: ['inherit', 'pipe', 'pipe'],
		env: { ...process.env, ...svc.env, FORCE_COLOR: '1', FORCE_STYLED_LOGS: '1' },
	});

	wireChildOutput(child, svc.name, onLine);

	child.on('exit', (code) => {
		onExit?.(svc.name, code);
	});

	onLine({
		service: 'dev',
		line: `[dev] started ${svc.name}`,
		at: Date.now(),
	});

	return child;
}

export function serviceRestartDelay(attempt) {
	const exponent = Math.max(0, Math.min(4, Number(attempt) || 0));
	return Math.min(1_000 * (2 ** exponent), 10_000);
}

/**
 * Keep each local service isolated: an unexpected exit restarts only that
 * service instead of terminating healthy siblings and aborting their work.
 */
export function startSupervisedService(
	svc,
	onLine,
	onExit,
	{
		start = startService,
		schedule = setTimeout,
		cancelSchedule = clearTimeout,
		now = Date.now,
	} = {},
) {
	let child = null;
	let restartTimer = null;
	let stopped = false;
	let attempts = 0;
	let startedAt = 0;

	const launch = () => {
		if (stopped) return;
		startedAt = now();
		child = start(svc, onLine, (name, code) => {
			if (stopped) return;
			if (now() - startedAt >= 30_000) attempts = 0;
			const restartDelayMs = serviceRestartDelay(attempts++);
			onLine({
				service: 'dev',
				line: `[dev] ${name} exited with code ${code ?? 'unknown'} — restarting in ${restartDelayMs}ms`,
				at: now(),
			});
			onExit?.(name, code, { restarting: true, restartDelayMs });
			restartTimer = schedule(launch, restartDelayMs);
		});
	};

	launch();
	return {
		get killed() { return stopped; },
		kill(signal = 'SIGTERM') {
			if (stopped) return;
			stopped = true;
			if (restartTimer) cancelSchedule(restartTimer);
			if (child && !child.killed) child.kill(signal);
		},
	};
}

export async function waitForBackends(isReady) {
	const timeoutMs = Number(process.env.DEV_BACKEND_WAIT_MS || 90_000);
	const intervalMs = 500;
	const started = Date.now();

	while (Date.now() - started < timeoutMs) {
		const results = await Promise.all(
			backendPorts.map(async (target) => ({
				...target,
				ready: await probe(target.host, target.port),
			})),
		);
		isReady?.(results);

		if (results.every((r) => r.ready)) {
			return { ready: true, results };
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}

	const pending = [];
	const results = [];
	for (const target of backendPorts) {
		const ready = await probe(target.host, target.port);
		results.push({ ...target, ready });
		if (!ready) pending.push(`${target.label}:${target.port}`);
	}

	return { ready: false, results, pending };
}
