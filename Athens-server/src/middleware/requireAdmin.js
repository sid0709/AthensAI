import { accountInfoCollection } from "../db/mongo.js";

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findAccountByName(name) {
	const trimmed = String(name ?? "").trim();
	if (!trimmed || !accountInfoCollection) return null;
	let acc = await accountInfoCollection.findOne({ name: trimmed });
	if (acc) return acc;
	return accountInfoCollection.findOne({
		name: { $regex: new RegExp(`^${escapeRegExp(trimmed)}$`, "i") },
	});
}

export function isAdminPermission(permission) {
	return String(permission ?? "").trim().toLowerCase() === "admin";
}

/**
 * Require the calling account (x-applier-name) to have permission: "admin".
 * Matches Athens' existing applier-name trust model (no session tokens).
 */
export async function requireAdmin(req, res, next) {
	try {
		if (!accountInfoCollection) {
			return res.status(503).json({ error: "Database not ready" });
		}

		const requester = String(req.headers["x-applier-name"] || "").trim();
		if (!requester) {
			return res.status(401).json({ error: "Admin authentication required" });
		}

		const account = await findAccountByName(requester);
		if (!account || !isAdminPermission(account.permission)) {
			return res.status(403).json({ error: "Admin permission required" });
		}

		req.adminAccount = account;
		return next();
	} catch (err) {
		return next(err);
	}
}
