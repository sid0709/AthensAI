import { createHash, randomBytes } from 'node:crypto';
import { getFirestoreDb } from './firebase/firebaseAdmin.js';

const COLLECTION = 'athens_lens_sessions';
const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const MIN_SESSION_TTL_SECONDS = 5 * 60;
const MAX_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const sessionCache = new Map();
const CACHE_MS = 30_000;

function sessionTtlSeconds() {
	const configured = Number.parseInt(String(process.env.ATHENS_LENS_SESSION_TTL_SECONDS || ''), 10);
	if (!Number.isFinite(configured)) return DEFAULT_SESSION_TTL_SECONDS;
	return Math.min(MAX_SESSION_TTL_SECONDS, Math.max(MIN_SESSION_TTL_SECONDS, configured));
}

function sessionId(token) {
	return createHash('sha256').update(String(token)).digest('hex');
}

function timestampIso(value) {
	if (value instanceof Date) return value.toISOString();
	if (typeof value?.toDate === 'function') return value.toDate().toISOString();
	const parsed = new Date(value || 0);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function publicSession(data = {}) {
	return {
		accountId: String(data.accountId || ''),
		profileId: String(data.profileId || data.accountId || ''),
		applierName: String(data.applierName || ''),
		username: String(data.username || ''),
		authenticatedAt: timestampIso(data.authenticatedAt),
		expiresAt: timestampIso(data.expiresAt),
	};
}

export async function createAthensLensSession({ accountId, profileId, applierName, username }) {
	const token = randomBytes(32).toString('base64url');
	const id = sessionId(token);
	const authenticatedAt = new Date();
	const expiresAt = new Date(authenticatedAt.getTime() + sessionTtlSeconds() * 1_000);
	const stored = {
		accountId: String(accountId),
		profileId: String(profileId || accountId),
		applierName: String(applierName),
		username: String(username).trim(),
		authenticatedAt,
		expiresAt,
		createdAt: authenticatedAt,
		updatedAt: authenticatedAt,
	};
	await getFirestoreDb().collection(COLLECTION).doc(id).create(stored);
	const session = publicSession(stored);
	sessionCache.set(id, { session, expiresAt: Date.now() + CACHE_MS });
	return { token, session };
}

export async function readAthensLensSession(token) {
	const normalizedToken = String(token || '').trim();
	if (!normalizedToken) return null;
	const id = sessionId(normalizedToken);
	const cached = sessionCache.get(id);
	if (cached?.expiresAt > Date.now()) return cached.session;
	const ref = getFirestoreDb().collection(COLLECTION).doc(id);
	const snapshot = await ref.get();
	if (!snapshot.exists) return null;
	const session = publicSession(snapshot.data());
	if (
		!session.accountId
		|| !session.profileId
		|| !session.applierName
		|| !session.username
		|| !session.expiresAt
		|| Date.parse(session.expiresAt) <= Date.now()
	) {
		sessionCache.delete(id);
		await ref.delete().catch(() => undefined);
		return null;
	}
	sessionCache.set(id, { session, expiresAt: Math.min(Date.parse(session.expiresAt), Date.now() + CACHE_MS) });
	return session;
}

export async function revokeAthensLensSession(token) {
	const normalizedToken = String(token || '').trim();
	if (!normalizedToken) return false;
	const id = sessionId(normalizedToken);
	sessionCache.delete(id);
	const ref = getFirestoreDb().collection(COLLECTION).doc(id);
	const snapshot = await ref.get();
	if (!snapshot.exists) return false;
	await ref.delete();
	return true;
}

export const athensLensSessionTest = { sessionKey: sessionId, sessionId, sessionTtlSeconds, publicSession };
