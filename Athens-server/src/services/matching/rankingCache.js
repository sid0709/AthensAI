import crypto from 'node:crypto';
import { getRedis, isRedisReady } from '../../db/redis.js';
import { getQueryTimeRankingLimits } from '../../config/graphAndVectorConfig.js';

const local = new Map();
const LOCAL_CACHE_MAX_ENTRIES = 500;

function writeLocal(key, value, ttlMs) {
  local.delete(key);
  local.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (local.size > LOCAL_CACHE_MAX_ENTRIES) {
    const oldest = local.keys().next().value;
    if (!oldest) break;
    local.delete(oldest);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function rankingFilterHash(body = {}) {
  const ignored = new Set(['page', 'limit', 'skip', 'countsOnly', 'rankingVersion']);
  const filtered = Object.fromEntries(Object.entries(body).filter(([key]) => !ignored.has(key)));
  return crypto.createHash('sha256').update(stableJson(filtered)).digest('hex').slice(0, 20);
}

export function rankingCacheKey({
  applierName,
  profileVersion,
  statusRevision = 0,
  dictionaryVersion,
  catalogRevision,
  filterHash,
}) {
  const owner = crypto.createHash('sha256').update(String(applierName || '')).digest('hex').slice(0, 16);
  return `ranking:v2:${owner}:${profileVersion}:${statusRevision}:${dictionaryVersion}:${catalogRevision}:${filterHash}`;
}

function statusRevisionKey(profileId) {
  return `ranking:v2:status-revision:${String(profileId || '')}`;
}

export async function getStatusRevision(profileId) {
  if (!profileId || !isRedisReady()) return '0';
  return String((await getRedis().get(statusRevisionKey(profileId))) || '0');
}

export async function bumpStatusRevision(profileId) {
  if (!profileId || !isRedisReady()) return '0';
  return String(await getRedis().incr(statusRevisionKey(profileId)));
}

export async function readRankingCache(key) {
  const localEntry = local.get(key);
  if (localEntry?.expiresAt > Date.now()) return localEntry.value;
  local.delete(key);
  if (!isRedisReady()) return null;
  const raw = await getRedis().get(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    writeLocal(key, value, 5_000);
    return value;
  } catch {
    return null;
  }
}

export function publishRankingCache(key, value) {
  const { cacheTtlSec } = getQueryTimeRankingLimits();
  writeLocal(key, value, Math.min(5_000, cacheTtlSec * 1000));
  if (!isRedisReady()) return;
  const task = setImmediate(() => {
    getRedis().setEx(key, cacheTtlSec, JSON.stringify(value)).catch((error) => {
      console.warn('[ranking] Redis result publication failed:', error?.message || error);
    });
  });
  task.unref?.();
}
