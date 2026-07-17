/**
 * Persistent IMAP connection pool.
 *
 * Every request was opening a fresh connection (TLS handshake + IMAP AUTH →
 * work → LOGOUT), which costs 1-3 seconds per operation. This pool reuses
 * authenticated connections across requests, eliminating that overhead.
 *
 * Design:
 *  - Pool keyed by email (one pool per Gmail account).
 *  - Up to IMAP_MAX_CONNS_PER_ACCOUNT (default 8) concurrent connections per account.
 *  - Idle connections are evicted after IDLE_TTL_MS (5 min).
 *  - A periodic sweep runs every 60s to close idle connections.
 *  - Connections are health-checked before being handed out.
 *  - If all connections are busy, a new one is created up to MAX_CONNS.
 *  - If MAX_CONNS is reached, callers wait for the next available connection.
 */

import { ImapFlow } from 'imapflow';

function envInt(name, fallback) {
  const n = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const MAX_CONNS_PER_ACCOUNT = envInt('IMAP_MAX_CONNS_PER_ACCOUNT', 8);
const IDLE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SWEEP_INTERVAL_MS = 60 * 1000; // 1 minute

/**
 * @typedef {object} PooledClient
 * @property {ImapFlow} client
 * @property {string} email
 * @property {boolean} busy
 * @property {number} lastUsedAt  // Date.now() timestamp
 * @property {number} createdAt   // Date.now() timestamp
 */

/** @type {Map<string, PooledClient[]>} */
const pools = new Map();

let sweepTimer = null;

/**
 * @param {ImapFlow} client
 * @returns {boolean}
 */
function isConnected(client) {
  try {
    // imapflow exposes .usable for this exact purpose
    return client.usable;
  } catch {
    return false;
  }
}

/**
 * Create and authenticate a new IMAP client.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<ImapFlow>}
 */
async function createClient(email, password) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
  });
  // ImapFlow extends EventEmitter. A socket-level failure on an idle pooled
  // connection (e.g. `read ETIMEDOUT`) emits an 'error' event — and an
  // unhandled 'error' on any EventEmitter is re-thrown by Node, crashing the
  // whole server. Swallow it here: the connection is left un-usable, and the
  // pool's health check (`client.usable`) + periodic sweep evict it.
  client.on('error', (err) => {
    console.warn(`[imap] connection error for ${email}: ${err?.message || err}`);
  });
  await client.connect();
  return client;
}

/**
 * Get or create a pool entry for an email.
 * @param {string} email
 * @returns {PooledClient[]}
 */
function getPool(email) {
  let pool = pools.get(email);
  if (!pool) {
    pool = [];
    pools.set(email, pool);
  }
  return pool;
}

/**
 * Acquire an idle, healthy connection from the pool. Creates a new one if
 * under MAX_CONNS_PER_ACCOUNT. Returns null if all connections are busy
 * and at capacity (caller should await and retry).
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<PooledClient>}
 */
async function acquireConnection(email, password) {
  const pool = getPool(email);
  const now = Date.now();

  // 1. Look for an idle, healthy connection
  for (const entry of pool) {
    if (entry.busy) continue;
    if (isConnected(entry.client)) {
      entry.busy = true;
      entry.lastUsedAt = now;
      return entry;
    }
    // Dead connection — remove it
    try { await entry.client.logout(); } catch { /* ignore */ }
    const idx = pool.indexOf(entry);
    if (idx !== -1) pool.splice(idx, 1);
  }

  // 2. Create a new connection if under limit
  if (pool.length < MAX_CONNS_PER_ACCOUNT) {
    const client = await createClient(email, password);
    const entry = { client, email, busy: true, lastUsedAt: now, createdAt: now };
    pool.push(entry);
    return entry;
  }

  return null;
}

/**
 * Release a connection back to the pool (mark idle).
 * @param {PooledClient} entry
 */
function releaseConnection(entry) {
  entry.busy = false;
  entry.lastUsedAt = Date.now();
}

/**
 * Evict idle connections past TTL and close dead ones.
 */
function sweep() {
  const now = Date.now();
  for (const [email, pool] of pools.entries()) {
    for (let i = pool.length - 1; i >= 0; i--) {
      const entry = pool[i];
      if (entry.busy) continue;
      const idleMs = now - entry.lastUsedAt;
      if (idleMs > IDLE_TTL_MS || !isConnected(entry.client)) {
        void entry.client.logout().catch(() => {});
        pool.splice(i, 1);
      }
    }
    if (pool.length === 0) pools.delete(email);
  }
}

// Start the periodic sweep.
function ensureSweepRunning() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  if (sweepTimer.unref) sweepTimer.unref(); // Don't keep the process alive
}
ensureSweepRunning();

/**
 * Execute a function with a pooled IMAP client. Reuses connections across
 * requests. If a mailbox path is provided, acquires the mailbox lock before
 * calling fn and releases it afterwards.
 *
 * Drop-in replacement for the old `withMailboxPath(email, password, mailboxPath, fn)`.
 *
 * @param {string} email
 * @param {string} password
 * @param {string} [mailboxPath]
 * @param {(client: ImapFlow) => Promise<any>} fn
 * @returns {Promise<any>}
 */
export async function withPooledClient(email, password, mailboxPath, fn) {
  const RETRY_DELAY_MS = 200;
  const MAX_WAIT_MS = 15000;
  const startedAt = Date.now();

  let entry;
  while (!entry) {
    entry = await acquireConnection(email, password);
    if (!entry) {
      if (Date.now() - startedAt > MAX_WAIT_MS) {
        throw new Error('IMAP connection pool exhausted — all connections busy');
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  try {
    if (mailboxPath) {
      const lock = await entry.client.getMailboxLock(mailboxPath);
      try {
        return await fn(entry.client);
      } finally {
        lock.release();
      }
    }
    return await fn(entry.client);
  } finally {
    releaseConnection(entry);
  }
}

/**
 * Shut down the pool — logout all connections. Call on process exit.
 */
export async function shutdownPool() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  for (const [email, pool] of pools.entries()) {
    for (const entry of pool) {
      try { await entry.client.logout(); } catch { /* ignore */ }
    }
    pools.delete(email);
  }
}
