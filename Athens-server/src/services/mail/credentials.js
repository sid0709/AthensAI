import { accountInfoCollection } from '../../db/mongo.js';
import { decryptProfileApiKeys } from '../autoBidProfileSecrets.js';

const accountCache = new Map();
const ACCOUNT_CACHE_MS = Math.max(5_000, Number(process.env.MAIL_ACCOUNT_CACHE_MS || 30_000));

async function findAccountByApplierName(nameRaw) {
	const trimmed = String(nameRaw ?? '').trim();
	if (!trimmed || !accountInfoCollection) return null;
	const cacheKey = trimmed.toLowerCase();
	const cached = accountCache.get(cacheKey);
	if (cached?.expiresAt > Date.now()) return cached.account;
	let acc = await accountInfoCollection.findOne(
		{ name: trimmed },
		{ projection: { name: 1, autoBidProfile: 1, tier: 1 } },
	);
	if (acc) {
		accountCache.set(cacheKey, { account: acc, expiresAt: Date.now() + ACCOUNT_CACHE_MS });
		return acc;
	}
	const esc = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	acc = await accountInfoCollection.findOne(
		{ name: { $regex: new RegExp(`^${esc}$`, 'i') } },
		{ projection: { name: 1, autoBidProfile: 1, tier: 1 } },
	);
	if (acc) accountCache.set(cacheKey, { account: acc, expiresAt: Date.now() + ACCOUNT_CACHE_MS });
	return acc || null;
}

export async function resolveMailCredentials(applierName) {
	const acc = await findAccountByApplierName(applierName);
	if (!acc) {
		return { ok: false, error: `No account named "${applierName}".` };
	}
	const profile = await decryptProfileApiKeys(acc.autoBidProfile || {});
	const email = String(profile.email ?? '').trim();
	const password = String(profile.gmailAppPassword ?? '').replace(/\s/g, '');
	if (!email || !password) {
		return {
			ok: false,
			error: 'Configure Gmail email and app password in Settings → Profile.',
		};
	}
	return { ok: true, email, password, applierName: acc.name };
}

export { findAccountByApplierName };
