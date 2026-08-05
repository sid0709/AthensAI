import { accountInfoCollection } from '../../db/dataStore.js';
import { decryptProfileApiKeysForClient } from '../autoBidProfileSecrets.js';

const accountCache = new Map();
const ACCOUNT_CACHE_MS = Math.max(5_000, Number(process.env.MAIL_ACCOUNT_CACHE_MS || 30_000));
const ACCOUNT_CACHE_MAX = Math.max(25, Number(process.env.MAIL_ACCOUNT_CACHE_MAX || 200));

function rememberAccount(key, account) {
	accountCache.delete(key);
	accountCache.set(key, { account, expiresAt: Date.now() + ACCOUNT_CACHE_MS });
	while (accountCache.size > ACCOUNT_CACHE_MAX) accountCache.delete(accountCache.keys().next().value);
}

export async function invalidateMailAccountCache(name) {
	const key = String(name || '').trim().toLowerCase();
	if (!key) return;
	accountCache.delete(key);
}

async function findAccountByApplierName(nameRaw) {
	const trimmed = String(nameRaw ?? '').trim();
	if (!trimmed || !accountInfoCollection) return null;
	const cacheKey = trimmed.toLowerCase();
	const cached = accountCache.get(cacheKey);
	if (cached?.expiresAt > Date.now()) {
		rememberAccount(cacheKey, cached.account);
		return cached.account;
	}
	accountCache.delete(cacheKey);
	let acc = await accountInfoCollection.findOne(
		{ name: trimmed },
		{ projection: { name: 1, autoBidProfile: 1, tier: 1 } },
	);
	if (acc) {
		rememberAccount(cacheKey, acc);
		return acc;
	}
	const esc = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	acc = await accountInfoCollection.findOne(
		{ name: { $regex: new RegExp(`^${esc}$`, 'i') } },
		{ projection: { name: 1, autoBidProfile: 1, tier: 1 } },
	);
	if (acc) rememberAccount(cacheKey, acc);
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
