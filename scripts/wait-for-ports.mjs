#!/usr/bin/env node
/**
 * Wait until configured local infrastructure accepts TCP connections.
 * Also exports probe() for prestart checks.
 */
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function probe(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(2_000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** PIDs holding a LISTEN socket on `port` (macOS/Linux via lsof). [] if none / lsof missing. */
async function listenersOnPort(port) {
  try {
    const { stdout } = await execFileAsync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
    return [...new Set(stdout.split(/\s+/).map((s) => Number(s.trim())))].filter(
      (pid) => Number.isInteger(pid) && pid > 0,
    );
  } catch {
    // lsof exits non-zero when nothing matches, or is absent (non-macOS/Linux) → treat as no listeners.
    return [];
  }
}

/**
 * Kill any process still listening on the given TCP ports so a fresh `npm start`
 * doesn't collide with a stale service from a previous run (the transient
 * ECONNREFUSED / port-in-use failures). SIGTERM first, then SIGKILL for
 * stragglers. Never touches our own PID. macOS/Linux only; a no-op elsewhere.
 * @param {number[]} ports
 * @param {(msg: string) => void} [log]
 */
export async function freePorts(ports, log = console.log) {
  const unique = [...new Set(ports.filter((p) => Number.isInteger(p) && p > 0))];
  for (const port of unique) {
    const pids = (await listenersOnPort(port)).filter((pid) => pid !== process.pid);
    if (!pids.length) continue;
    log(`[prestart] Port ${port} busy — stopping stale process ${pids.join(', ')}`);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    // Give them a moment to release the socket, then force-kill anything still holding it.
    await new Promise((r) => setTimeout(r, 500));
    for (const pid of await listenersOnPort(port)) {
      if (pid === process.pid) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}
