import { createHash, randomBytes } from "node:crypto";
import { getRedis, isRedisReady } from "../db/redis.js";

const SESSION_KEY_PREFIX = "athens-lens:session:v1:";
const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const MIN_SESSION_TTL_SECONDS = 5 * 60;
const MAX_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function sessionTtlSeconds() {
	const configured = Number.parseInt(String(process.env.ATHENS_LENS_SESSION_TTL_SECONDS || ""), 10);
	if (!Number.isFinite(configured)) return DEFAULT_SESSION_TTL_SECONDS;
	return Math.min(MAX_SESSION_TTL_SECONDS, Math.max(MIN_SESSION_TTL_SECONDS, configured));
}

function sessionKey(token) {
	const digest = createHash("sha256").update(String(token)).digest("hex");
	return `${SESSION_KEY_PREFIX}${digest}`;
}

function requireSessionStore() {
	if (!isRedisReady()) {
		throw Object.assign(new Error("Sign-in sessions are temporarily unavailable"), {
			status: 503,
			code: "SESSION_STORE_UNAVAILABLE",
		});
	}
	return getRedis();
}

export async function createAthensLensSession({ accountId, applierName, username }) {
	const redis = requireSessionStore();
	const token = randomBytes(32).toString("base64url");
	const authenticatedAt = new Date();
	const expiresAt = new Date(authenticatedAt.getTime() + sessionTtlSeconds() * 1_000);
	const session = {
		accountId: String(accountId),
		applierName: String(applierName),
		username: String(username).trim(),
		authenticatedAt: authenticatedAt.toISOString(),
		expiresAt: expiresAt.toISOString(),
	};

	await redis.setEx(sessionKey(token), sessionTtlSeconds(), JSON.stringify(session));
	return { token, session };
}

export async function readAthensLensSession(token) {
	const normalizedToken = String(token || "").trim();
	if (!normalizedToken) return null;

	const serialized = await requireSessionStore().get(sessionKey(normalizedToken));
	if (!serialized) return null;

	try {
		const session = JSON.parse(serialized);
		if (
			!session?.accountId ||
			!session?.applierName ||
			!session?.username ||
			!session?.expiresAt ||
			Date.parse(session.expiresAt) <= Date.now()
		) {
			await getRedis().del(sessionKey(normalizedToken));
			return null;
		}
		return session;
	} catch {
		await getRedis().del(sessionKey(normalizedToken));
		return null;
	}
}

export async function revokeAthensLensSession(token) {
	const normalizedToken = String(token || "").trim();
	if (!normalizedToken || !isRedisReady()) return false;
	return (await getRedis().del(sessionKey(normalizedToken))) > 0;
}

export const athensLensSessionTest = { sessionKey, sessionTtlSeconds };
