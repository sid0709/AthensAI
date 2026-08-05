import { readAthensLensSession } from "../services/athensLensSessionService.js";

function bearerToken(req) {
	const header = String(req.headers.authorization || "").trim();
	return header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

export async function requireAthensLensSession(req, res, next) {
	try {
		const token = bearerToken(req);
		const session = await readAthensLensSession(token);
		if (!session) {
			return res.status(401).json({
				success: false,
				code: "SESSION_INVALID",
				message: "Your Athens Lens session has expired. Sign in again.",
			});
		}

		req.athensLensToken = token;
		req.athensLensSession = session;
		return next();
	} catch (error) {
		console.error("[athens-lens] session validation failed", error?.message || error);
		return res.status(503).json({
			success: false,
			code: "SESSION_STORE_UNAVAILABLE",
			message: "Sign-in sessions are temporarily unavailable",
		});
	}
}

export const athensLensAuthTest = { bearerToken };
