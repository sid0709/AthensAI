import { createClient } from 'redis';

let client = null;
let ready = false;
const guardedClients = new WeakSet();

/** Every node-redis client, including duplicates, must consume error events. */
export function attachRedisErrorHandler(
  redisClient,
  { label = 'client', onError, logger = console.error } = {},
) {
  if (!redisClient?.on || guardedClients.has(redisClient)) return redisClient;
  guardedClients.add(redisClient);
  redisClient.on('error', (error) => {
    onError?.(error);
    logger(`[redis] ${label} error:`, error?.message || error);
  });
  return redisClient;
}

export function isRedisReady() {
  return ready && client?.isOpen;
}

export function getRedis() {
  if (!client) throw new Error('Redis not initialized');
  return client;
}

/** Duplicate the shared client without creating an unhandled EventEmitter path. */
export function duplicateRedisClient(label = 'duplicate') {
  return attachRedisErrorHandler(getRedis().duplicate(), { label });
}

export function isRedisConnectionError(error) {
  return /redis|socket closed|econnrefused|econnreset|connection (?:is )?closed/i.test(
    String(error?.message || error || ''),
  ) || [
    'SocketClosedUnexpectedlyError',
    'ConnectionTimeoutError',
  ].includes(String(error?.name || ''));
}

export function shouldInitializeRedis({ force = false } = {}) {
	if (process.env.REDIS_ENABLED === 'false') return false;
	return force || process.env.REDIS_ENABLED === 'true' || Boolean(String(process.env.REDIS_URL || '').trim());
}

export async function initRedis({ force = false } = {}) {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  if (!shouldInitializeRedis({ force })) {
    console.log('[redis] not configured — optional caches disabled');
    return false;
  }
  if (client?.isOpen) {
    ready = true;
    return true;
  }
  let connecting = true;
  let connectedOnce = false;
  try {
    const maxReconnectAttempts = Math.max(0, Number(process.env.REDIS_CONNECT_RETRIES || 2));
    client = createClient({
      url,
      socket: {
        connectTimeout: Math.max(250, Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1000)),
        // Fail fast only during initial startup. Once Redis has connected, keep
        // retrying indefinitely so a Docker/Redis restart degrades the service
        // temporarily instead of requiring every Node process to be restarted.
        reconnectStrategy: (retries) => {
          if (!connectedOnce && retries >= maxReconnectAttempts) return false;
          return Math.min(100 * (2 ** Math.min(retries, 4)), 2_000);
        },
      },
    });
    attachRedisErrorHandler(client, {
      label: 'primary',
      onError: () => { ready = false; },
      logger: (...args) => {
        if (!connecting) console.error(...args);
      },
    });
    client.on('ready', () => {
      connectedOnce = true;
      ready = true;
    });
    client.on('reconnecting', () => { ready = false; });
    client.on('end', () => { ready = false; });
    await client.connect();
    connecting = false;
    ready = true;
    console.log(`[redis] connected → ${url}`);
    return true;
  } catch (err) {
    connecting = false;
    console.warn('[redis] unavailable — ranking falls back safely:', err.message);
    ready = false;
    client?.removeAllListeners();
    client = null;
    return false;
  }
}

export async function closeRedis() {
  if (client?.isOpen) await client.quit();
  client = null;
  ready = false;
}
