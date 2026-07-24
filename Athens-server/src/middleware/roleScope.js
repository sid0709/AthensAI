const BIDDER_ROUTES = [
	["GET", /^\/api\/auth\/session$/],
	["GET", /^\/api\/account_info(?:\/by\/[^/]+)?$/],
	["GET", /^\/api\/agents\/health$/],
	["GET", /^\/api\/vendor\/tasks(?:\/analytics)?$/],
	["PATCH", /^\/api\/vendor\/tasks\/[^/]+$/],
	["GET", /^\/api\/bid-results(?:\/.*)?$/],
	["POST", /^\/api\/bid-results(?:\/.*)?$/],
	["PATCH", /^\/api\/bid-results\/[^/]+$/],
	["POST", /^\/api\/bid-recordings(?:\/.*)?$/],
	["POST", /^\/api\/job-analyze(?:\/.*)?$/],
	["POST", /^\/api\/personal\/agent-job-resumes\/status$/],
	["GET", /^\/api\/personal\/agent-job-resume\/[^/]+\/pdf$/],
];

function role(req) {
	return String(req.auth?.role || "").trim().toLowerCase();
}

/** Keep separately authenticated bidder accounts inside the extension workflow. */
export function requireRoleScope(req, res, next) {
	if (!req.auth || req.auth.admin === true || role(req) !== "bidder") return next();
	const path = new URL(req.originalUrl, "http://athens.internal").pathname;
	const allowed = BIDDER_ROUTES.some(([method, pattern]) => method === req.method && pattern.test(path));
	if (allowed) return next();
	return res.status(403).json({ success: false, error: "Bidder role cannot access this endpoint" });
}

export { BIDDER_ROUTES };
