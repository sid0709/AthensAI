const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const READ_ONLY_POSTS = new Set(["/api/auth/signin", "/api/auth/bidder-signin"]);

export function writesEnabled() {
	const raw = String(process.env.FIRESTORE_WRITES_ENABLED || "").trim().toLowerCase();
	if (!raw) return process.env.NODE_ENV !== "production";
	return raw === "true";
}

export function requireWritesEnabled(req, res, next) {
	if (!MUTATING.has(req.method) || writesEnabled()) return next();
	const pathname = new URL(req.originalUrl || req.url, "http://athens.internal").pathname;
	if (req.method === "POST" && READ_ONLY_POSTS.has(pathname)) return next();
	const admin = req.auth?.admin === true || String(req.auth?.role || "").toLowerCase() === "admin";
	if (admin && String(req.headers["x-migration-test"] || "").toLowerCase() === "true") return next();
	return res.status(503).json({
		success: false,
		code: "WRITES_DISABLED",
		error: "Production is read-only during Firebase migration verification",
	});
}
