import { accountInfoCollection } from '../../db/dataStore.js';
import { decryptProfileApiKeysForClient } from '../autoBidProfileSecrets.js';
import { getRedis, isRedisReady } from '../../db/redis.js';

const accountCache = new Map();
const ACCOUNT_CACHE_MS = Math.max(5_000, Number(process.env.MAIL_ACCOUNT_CACHE_MS || 30_000));
const ACCOUNT_REDIS_CACHE_SEC = Math.max(15, Number(process.env.MAIL_ACCOUNT_REDIS_CACHE_SEC || 60));

function accountRedisKey(name) {
	return `mail:v2:account:${String(name).trim().toLowerCase()}`;
}

export async function invalidateMailAccountCache(name) {
	const key = String(name || '').trim().toLowerCase();
	if (!key) return;
	accountCache.delete(key);
	if (isRedisReady()) await getRedis().del(accountRedisKey(key)).catch(() => undefined);
}

async function findAccountByApplierName(nameRaw) {
	const trimmed = String(nameRaw ?? '').trim();
	if (!trimmed || !accountInfoCollection) return null;
	const cacheKey = trimmed.toLowerCase();
	const cached = accountCache.get(cacheKey);
	if (cached?.expiresAt > Date.now()) return cached.account;
	if (isRedisReady()) {
		const redisValue = await getRedis().get(accountRedisKey(cacheKey)).catch(() => null);
		if (redisValue) {
			try {
				const account = JSON.parse(redisValue);
				accountCache.set(cacheKey, { account, expiresAt: Date.now() + ACCOUNT_CACHE_MS });
				return account;
			} catch {
				await getRedis().del(accountRedisKey(cacheKey)).catch(() => undefined);
			}
		}
	}
	let acc = await accountInfoCollection.findOne(
		{ name: trimmed },
		{ projection: { name: 1, autoBidProfile: 1, tier: 1 } },
	);
	if (acc) {
		accountCache.set(cacheKey, { account: acc, expiresAt: Date.now() + ACCOUNT_CACHE_MS });
		if (isRedisReady()) {
			await getRedis().setEx(accountRedisKey(cacheKey), ACCOUNT_REDIS_CACHE_SEC, JSON.stringify(acc)).catch(() => undefined);
		}
		return acc;
	}
	const esc = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	acc = await accountInfoCollection.findOne(
		{ name: { $regex: new RegExp(`^${esc}$`, 'i') } },
		{ projection: { name: 1, autoBidProfile: 1, tier: 1 } },
	);
	if (acc) {
		accountCache.set(cacheKey, { account: acc, expiresAt: Date.now() + ACCOUNT_CACHE_MS });
		if (isRedisReady()) {
			await getRedis().setEx(accountRedisKey(cacheKey), ACCOUNT_REDIS_CACHE_SEC, JSON.stringify(acc)).catch(() => undefined);
		}
	}
	return acc || null;
}

export async function resolveMailCredentials(applierName) {
	const acc = await findAccountByApplierName(applierName);
	if (!acc) {
		return { ok: false, error: `No account named "${applierName}".` };
	}
	const { profile, unavailableFields } = await decryptProfileApiKeysForClient(acc.autoBidProfile || {});
	const email = String(profile.email ?? '').trim();
	const password = String(profile.gmailAppPassword ?? '').replace(/\s/g, '');
	if (unavailableFields.includes('gmailAppPassword')) {
		return {
			ok: false,
			error: 'The stored Gmail app password cannot be decrypted here. Re-enter it in Settings → Profile.',
		};
	}
	if (!email || !password) {
		return {
			ok: false,
			error: 'Configure Gmail email and app password in Settings → Profile.',
		};
	}
	return { ok: true, email, password, applierName: acc.name };
}

export { findAccountByApplierName };
