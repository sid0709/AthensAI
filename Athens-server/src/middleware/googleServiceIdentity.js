import { OAuth2Client } from "google-auth-library";

const verifier = new OAuth2Client();

export async function requireGoogleServiceIdentity(req, res, next) {
	const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
	const audience = String(process.env.ATHENS_INTERNAL_URL || "").replace(/\/$/, "");
	const allowed = new Set(String(process.env.ALLOWED_TASK_SERVICE_ACCOUNTS || process.env.TASK_SERVICE_ACCOUNT_EMAIL || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
	if (process.env.NODE_ENV !== "production" && !token) return next();
	try {
		if (!token || !audience || !allowed.size) throw new Error("Task identity configuration missing");
		const ticket = await verifier.verifyIdToken({ idToken: token, audience });
		const payload = ticket.getPayload();
		if (!payload?.email_verified || !allowed.has(String(payload.email || "").toLowerCase())) throw new Error("Task identity denied");
		req.serviceAuth = payload;
		return next();
	} catch (error) {
		return res.status(401).json({ success: false, error: error.message || "Invalid task identity" });
	}
}
