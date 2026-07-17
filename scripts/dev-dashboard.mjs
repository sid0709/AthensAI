#!/usr/bin/env node
/**
 * Ink TUI dev dashboard — structured, colorized multi-service log output.
 * Plain ESM (no tsx) so yoga-layout loads natively as ESM with top-level await.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { render, Box, Text, Static, useApp, useInput, useStdout } from 'ink';
import { parseStyledLine, TAG_COLORS } from '../packages/shared/src/terminal-log.js';
import {
	backendPorts,
	backendServices,
	getDevSummary,
	startService,
	uiService,
	waitForBackends,
} from './lib/dev-runtime.mjs';

const h = React.createElement;

const MAX_LOGS = 400;
const SERVICE_COLORS = {
	'athens-server': 'magenta',
	'ai-bff': 'cyan',
	'athens-ui': 'green',
	dev: 'gray',
};

function levelColor(level) {
	if (level === 'error') return 'red';
	if (level === 'warn') return 'yellow';
	return 'white';
}

function LogLine({ entry }) {
	const parsed = parseStyledLine(entry.line, entry.service);
	const serviceColor = SERVICE_COLORS[entry.service] || 'white';
	const tagColor = TAG_COLORS[parsed.tag] ? 'cyan' : 'gray';

	return h(
		Box,
		{ flexDirection: 'row', columnGap: 1 },
		h(Text, { dimColor: true }, parsed.time || '          '),
		h(Text, { color: levelColor(parsed.level) }, parsed.level === 'error' ? '✖' : parsed.level === 'warn' ? '▲' : '●'),
		h(Text, { color: serviceColor, bold: true }, entry.service.padEnd(14)),
		h(Text, { color: tagColor }, parsed.tag.padEnd(16)),
		h(Text, { wrap: 'truncate-end' }, parsed.message),
	);
}

function ServiceRow({ label, port, status }) {
	const color = status === 'ready' ? 'green' : status === 'failed' ? 'red' : status === 'starting' ? 'yellow' : 'gray';
	const icon = status === 'ready' ? '●' : status === 'failed' ? '✖' : '○';

	return h(
		Box,
		{ columnGap: 2 },
		h(Text, { color }, icon),
		h(Text, { bold: true }, label.padEnd(16)),
		h(Text, { dimColor: true }, `:${port}`),
		h(Text, { color }, status),
	);
}

function Header() {
	return h(
		Box,
		{ flexDirection: 'column', marginBottom: 1 },
		h(
			Box,
			{ borderStyle: 'round', borderColor: 'blue', paddingX: 1, justifyContent: 'space-between' },
			h(Text, { bold: true, color: 'magenta' }, 'NextOffer Dev'),
			h(Text, { dimColor: true }, 'Ctrl+C to stop all services'),
		),
	);
}

function EndpointsPanel({ summary }) {
	return h(
		Box,
		{ flexDirection: 'column', marginTop: 1, borderStyle: 'single', borderColor: 'gray', paddingX: 1 },
		h(Text, { bold: true, color: 'blue' }, 'Endpoints'),
		...summary.endpoints.map((ep) =>
			h(
				Box,
				{ key: ep.label, columnGap: 1 },
				h(Text, { dimColor: true }, ep.label.padEnd(16)),
				h(Text, { color: 'cyan' }, ep.url),
			),
		),
		...summary.networkLines.map((line) => h(Text, { key: line, dimColor: true }, line)),
	);
}

function DevDashboard() {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const childrenRef = useRef([]);
	const [logs, setLogs] = useState([]);
	const [portStatus, setPortStatus] = useState(() =>
		Object.fromEntries(backendPorts.map((p) => [p.service, 'starting'])),
	);
	const [phase, setPhase] = useState('booting');
	const summary = getDevSummary();

	const pushLog = useCallback((entry) => {
		setLogs((prev) => {
			const next = [...prev, { ...entry, id: `${entry.at}-${prev.length}` }];
			return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
		});
	}, []);

	const shutdown = useCallback(
		(code = 0) => {
			for (const child of childrenRef.current) {
				if (child && !child.killed) child.kill('SIGTERM');
			}
			exit();
			process.exit(code);
		},
		[exit],
	);

	useInput((input, key) => {
		if (key.ctrl && input === 'c') shutdown(0);
	});

	useEffect(() => {
		const onSignal = () => shutdown(0);
		process.on('SIGINT', onSignal);
		process.on('SIGTERM', onSignal);
		return () => {
			process.off('SIGINT', onSignal);
			process.off('SIGTERM', onSignal);
		};
	}, [shutdown]);

	useEffect(() => {
		const onLine = (entry) => pushLog(entry);
		const onExit = (name, code) => {
			if (code && code !== 0) {
				pushLog({ service: 'dev', line: `[dev] ${name} exited with code ${code}`, at: Date.now() });
				setPortStatus((s) => ({ ...s, [name]: 'failed' }));
				shutdown(code);
			}
		};

		for (const svc of backendServices) {
			childrenRef.current.push(startService(svc, onLine, onExit));
		}

		(async () => {
			const result = await waitForBackends((results) => {
				setPortStatus((prev) => {
					const next = { ...prev };
					for (const row of results) {
						next[row.service] = row.ready ? 'ready' : 'starting';
					}
					return next;
				});
			});

			for (const row of result.results) {
				setPortStatus((s) => ({ ...s, [row.service]: row.ready ? 'ready' : 'failed' }));
			}

			if (result.ready) {
				pushLog({ service: 'dev', line: '[dev] backend ports ready', at: Date.now() });
			} else if (result.pending?.length) {
				pushLog({
					service: 'dev',
					line: `[dev] timed out waiting for backends (${result.pending.join(', ')}) — starting UI anyway`,
					at: Date.now(),
				});
			}

			childrenRef.current.push(startService(uiService, onLine, onExit));
			setPhase('running');
			pushLog({ service: 'dev', line: 'NextOffer is running — see Endpoints below', at: Date.now() });
		})();

		return () => {
			for (const child of childrenRef.current) {
				if (child && !child.killed) child.kill('SIGTERM');
			}
		};
	}, [pushLog, shutdown]);

	const rows = stdout?.rows ?? 40;
	const logHeight = Math.max(8, rows - 22);

	return h(
		Box,
		{ flexDirection: 'column', paddingX: 1 },
		h(Header),
		h(
			Box,
			{ flexDirection: 'column', marginBottom: 1 },
			h(Text, { bold: true, color: 'blue' }, 'Services'),
			...backendPorts.map((p) =>
				h(ServiceRow, {
					key: p.service,
					label: p.label,
					port: p.port,
					status: portStatus[p.service] || 'starting',
				}),
			),
			h(ServiceRow, {
				label: 'Athens UI',
				port: summary.devPort,
				status: phase === 'running' ? 'ready' : 'starting',
			}),
		),
		h(
			Box,
			{ flexDirection: 'column', height: logHeight, borderStyle: 'single', borderColor: 'gray', paddingX: 1 },
			h(Text, { bold: true, color: 'blue' }, 'Activity'),
			h(
				Box,
				{ flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
				h(Static, { items: logs }, (entry) => h(Box, { key: entry.id }, h(LogLine, { entry }))),
			),
		),
		phase === 'running' ? h(EndpointsPanel, { summary }) : null,
	);
}

render(h(DevDashboard));
