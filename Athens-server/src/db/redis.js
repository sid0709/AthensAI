import { createClient } from 'redis';

let client = null;
let ready = false;

export function isRedisReady() {
  return ready && client?.isOpen;
}

export function getRedis() {
  if (!client) throw new Error('Redis not initialized');
  return client;
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
  try {
    const maxReconnectAttempts = Math.max(0, Number(process.env.REDIS_CONNECT_RETRIES || 2));
    client = createClient({
      url,
      socket: {
        connectTimeout: Math.max(250, Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1000)),
        reconnectStrategy: (retries) => (
          retries >= maxReconnectAttempts ? false : Math.min(100 * (2 ** retries), 500)
        ),
      },
    });
    client.on('error', (err) => {
      if (!connecting) console.error('[redis] error:', err.message);
      ready = false;
    });
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
