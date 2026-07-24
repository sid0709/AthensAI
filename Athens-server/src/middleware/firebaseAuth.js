import { getFirebaseAuth, getFirestoreDb } from "../services/firebase/firebaseAdmin.js";

const ACCESS_CACHE_MS = 60_000;
const accessCache = new Map();

function authRequired() {
	const raw = String(process.env.FIREBASE_AUTH_REQUIRED ?? "").trim().toLowerCase();
	if (raw) return !["0", "false", "no", "off"].includes(raw);
	return process.env.NODE_ENV === "production";
}

function bearerToken(req) {
	const header = String(req.headers.authorization || "").trim();
	const match = header.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || "";
}

function normalizeProfileName(value) {
	return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

async function loadAccess(uid) {
	const cached = accessCache.get(uid);
	if (cached && cached.expiresAt > Date.now()) return cached.value;

	const snapshot = await getFirestoreDb()
		.collection("profile_access")
		.where("uid", "==", uid)
		.get();
	const grants = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
	const value = {
		grants,
		profileIds: new Set(grants.map((grant) => String(grant.profileId || "")).filter(Boolean)),
		profileNames: new Set(
			grants
				.flatMap((grant) => [grant.profileName, grant.applierName])
				.map(normalizeProfileName)
				.filter(Boolean),
		),
	};
	accessCache.set(uid, { value, expiresAt: Date.now() + ACCESS_CACHE_MS });
	return value;
}

function requestedProfiles(req) {
	const values = [
		req.body?.applierName,
		req.body?.ownerName,
		req.query?.applierName,
		req.query?.ownerName,
		req.body?.profileId,
		req.query?.profileId,
		req.params?.profileId,
		req.params?.applierName,
		req.headers["x-applier-name"],
	];
	return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function isAdmin(decoded) {
	return decoded?.admin === true || String(decoded?.role || "").toLowerCase() === "admin";
}

function grantFor(access, requested = []) {
	const grants = access?.grants || [];
	for (const value of requested) {
		const normalized = normalizeProfileName(value);
		const match = grants.find((grant) =>
			String(grant.profileId || "") === value ||
			[grant.profileName, grant.applierName].some((name) => normalizeProfileName(name) === normalized),
		);
		if (match) return match;
	}
	return grants.find((grant) => grant.primary) || (grants.length === 1 ? grants[0] : null);
}

function injectGrantedProfile(req, grant) {
	const profileName = String(grant?.profileName || grant?.applierName || "").trim();
	const profileId = String(grant?.profileId || "").trim();
	if (!profileName || !profileId) return;
	req.authProfile = grant;
	if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
		req.body.applierName ||= profileName;
		req.body.ownerName ||= profileName;
		req.body.profileId ||= profileId;
	}
	const url = new URL(req.url, "http://athens.internal");
	if (!url.searchParams.has("applierName")) url.searchParams.set("applierName", profileName);
	if (!url.searchParams.has("ownerName")) url.searchParams.set("ownerName", profileName);
	if (!url.searchParams.has("profileId")) url.searchParams.set("profileId", profileId);
	req.url = `${url.pathname}${url.search}`;
}

/**
 * Verify Firebase ID tokens and authorize any profile identity explicitly
 * present in the request. Route handlers can use req.auth and req.profileAccess.
 */
export async function requireFirebaseAuth(req, res, next) {
	try {
		const token = bearerToken(req);
		if (!token) {
			if (!authRequired()) return next();
			return res.status(401).json({ success: false, error: "Firebase ID token required" });
		}

		const decoded = await getFirebaseAuth().verifyIdToken(token, true);
		const access = await loadAccess(decoded.uid);
		req.auth = decoded;
		req.profileAccess = access;

		if (!isAdmin(decoded)) {
			const requested = requestedProfiles(req);
			for (const value of requested) {
				const normalized = normalizeProfileName(value);
				if (!access.profileIds.has(value) && !access.profileNames.has(normalized)) {
					return res.status(403).json({
						success: false,
						error: "Profile access denied",
					});
				}
			}
			const grant = grantFor(access, requested);
			if (!grant) return res.status(403).json({ success: false, error: "A primary profile grant is required" });
			injectGrantedProfile(req, grant);
		}

		return next();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return res.status(401).json({ success: false, error: "Invalid or revoked Firebase ID token", detail: message });
	}
}

export async function requireFirebaseSocket(socket, next) {
	try {
		const token =
			String(socket.handshake.auth?.token || "").trim() ||
			String(socket.handshake.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
		if (!token) {
			if (!authRequired()) return next();
			return next(new Error("Firebase ID token required"));
		}
		const decoded = await getFirebaseAuth().verifyIdToken(token, true);
		socket.data.auth = decoded;
		socket.data.profileAccess = await loadAccess(decoded.uid);
		const requestedProfile = String(socket.handshake.auth?.profileId || "").trim();
		if (requestedProfile && !isAdmin(decoded) && !socket.data.profileAccess.profileIds.has(requestedProfile)) {
			return next(new Error("Profile access denied"));
		}
		socket.data.requestedProfile = requestedProfile || null;
		return next();
	} catch {
		return next(new Error("Invalid or revoked Firebase ID token"));
	}
}

export function clearProfileAccessCache(uid) {
	if (uid) accessCache.delete(uid);
	else accessCache.clear();
}

export const firebaseAuthTest = { grantFor, injectGrantedProfile, requestedProfiles };
