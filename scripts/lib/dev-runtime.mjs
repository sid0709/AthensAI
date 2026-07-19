/**
 * Shared dev orchestration — spawn services, probe ports, shutdown.
 * Logic unchanged from the original dev-start.mjs; only factored out for the Ink UI.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe } from '../wait-for-ports.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const ROOT_DIR = ROOT;

export const backendServices = [
	{ name: 'athens-server', label: 'Athens-server', cmd: 'npm', args: ['run', 'start', '-w', 'Athens-server'], cwd: ROOT },
	{ name: 'avalon-relay', label: 'Avalon relay', cmd: 'npm', args: ['run', 'start', '-w', '@avalon/backend'], cwd: ROOT },
	{ name: 'ai-bff', label: 'AI BFF', cmd: 'npm', args: ['run', 'dev', '-w', 'ai-bff'], cwd: ROOT },
];

export const uiService = {
	name: 'athens-ui',
	label: 'Athens UI',
	cmd: 'npm',
	args: ['run', 'dev'],
	cwd: path.join(ROOT, 'Athens'),
};

export const backendPorts = [
	{ host: '127.0.0.1', port: Number(process.env.ATHENS_SERVER_PORT || 8979), label: 'Athens-server', service: 'athens-server' },
	{ host: '127.0.0.1', port: Number(process.env.AVALON_PORT || 3847), label: 'Avalon relay', service: 'avalon-relay' },
	{ host: '127.0.0.1', port: Number(process.env.AI_BFF_PORT || 3920), label: 'AI BFF', service: 'ai-bff' },
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
	const networkLines = lanAddresses().map((ip) => `Frontend (LAN) → http://${ip}:${devPort}`);
	return {
		devPort,
		networkLines,
		endpoints: [
			{ label: 'Frontend', url: `http://localhost:${devPort}` },
			{ label: 'Athens-server', url: 'http://localhost:8979' },
			{ label: 'Avalon relay', url: 'http://localhost:3847' },
			{ label: 'AI BFF', url: 'http://localhost:3920' },
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
		env: { ...process.env, FORCE_COLOR: '1', FORCE_STYLED_LOGS: '1' },
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
