import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const CACHE_MS = 60_000;
const cache = new Map();

function required() {
	const raw = String(process.env.FIREBASE_AUTH_REQUIRED ?? "").trim().toLowerCase();
	if (raw) return !["0", "false", "no", "off"].includes(raw);
	return process.env.NODE_ENV === "production";
}

function ensureApp() {
	if (getApps().length) return getApps()[0];
	return initializeApp({
		credential: applicationDefault(),
		projectId: process.env.FIREBASE_PROJECT_ID?.trim() || undefined,
	});
}

async function accessFor(uid) {
	const hit = cache.get(uid);
	if (hit && hit.expiresAt > Date.now()) return hit.profileIds;
	ensureApp();
	const snapshot = await getFirestore().collection("profile_access").where("uid", "==", uid).get();
	const profileIds = new Set(snapshot.docs.map((doc) => String(doc.data().profileId || "")).filter(Boolean));
	cache.set(uid, { profileIds, expiresAt: Date.now() + CACHE_MS });
	return profileIds;
}

export async function authenticateSocket(socket, next) {
	const token =
		String(socket.handshake.auth?.token || "").trim() ||
		String(socket.handshake.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
	if (!token) {
		if (!required()) return next();
		return next(new Error("Firebase ID token required"));
	}
	try {
		ensureApp();
		const decoded = await getAuth().verifyIdToken(token, true);
		socket.data.auth = decoded;
		socket.data.profileIds = await accessFor(decoded.uid);
		return next();
	} catch {
		return next(new Error("Invalid or revoked Firebase ID token"));
	}
}

export function canAccessProfile(socket, profileId) {
	if (!socket.data.auth) return !required();
	if (socket.data.auth.admin === true || socket.data.auth.role === "admin") return true;
	return socket.data.profileIds?.has(String(profileId || "")) || false;
}

export async function authenticateHttp(req, res, next) {
	const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
	if (!token) {
		if (!required()) return next();
		return res.status(401).json({ ok: false, error: "Firebase ID token required" });
	}
	try {
		ensureApp();
		const decoded = await getAuth().verifyIdToken(token, true);
		req.auth = decoded;
		req.profileIds = await accessFor(decoded.uid);
		return next();
	} catch {
		return res.status(401).json({ ok: false, error: "Invalid or revoked Firebase ID token" });
	}
}

export function canAccessHttpProfile(req, profileId) {
	if (!req.auth) return !required();
	if (req.auth.admin === true || req.auth.role === "admin") return true;
	return req.profileIds?.has(String(profileId || "")) || false;
}
