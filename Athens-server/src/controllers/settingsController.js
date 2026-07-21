import bcrypt from "bcrypt";
import { accountInfoCollection } from "../db/mongo.js";
import { updateAccountInfoById } from "../services/accountInfoStore.js";
import { findAccountForDelete, wipeAccountData } from "../services/deleteAccountService.js";

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findAccountByName(name) {
	const trimmed = String(name ?? "").trim();
	if (!trimmed) return null;
	let acc = await accountInfoCollection.findOne({ name: trimmed });
	if (acc) return acc;
	return accountInfoCollection.findOne({
		name: { $regex: new RegExp(`^${escapeRegExp(trimmed)}$`, "i") },
	});
}

const DEFAULT_NOTIFICATION_PREFS = {
	applications: true,
	interviews: true,
	jobs: true,
	agents: true,
	mail: true,
};

export async function getNotificationPrefs(req, res) {
	try {
		if (!accountInfoCollection) return res.status(503).json({ success: false, error: "Database not ready" });
		const name = String(req.query?.applierName || "").trim();
		if (!name) return res.status(400).json({ success: false, error: "applierName query required" });

		const acc = await findAccountByName(name);
		if (!acc) {
			return res.json({ success: true, accountExists: false, prefs: DEFAULT_NOTIFICATION_PREFS });
		}

		const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(acc.notificationPrefs || {}) };
		return res.json({ success: true, accountExists: true, prefs });
	} catch (err) {
		console.error("GET /api/settings/notifications error", err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function updateNotificationPrefs(req, res) {
	try {
		if (!accountInfoCollection) return res.status(503).json({ success: false, error: "Database not ready" });
		const body = req.body || {};
		const name = String(body.applierName || "").trim();
		if (!name) return res.status(400).json({ success: false, error: "applierName required in body" });

		const acc = await findAccountByName(name);
		if (!acc) {
			return res.status(404).json({ success: false, error: `No account named "${name}".` });
		}

		const prefs = {
			applications: body.applications !== false,
			interviews: body.interviews !== false,
			jobs: body.jobs !== false,
			agents: body.agents !== false,
			mail: body.mail !== false,
		};

		await updateAccountInfoById(acc._id, acc.name, { $set: { notificationPrefs: prefs } });
		return res.json({ success: true, prefs });
	} catch (err) {
		console.error("PUT /api/settings/notifications error", err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function changePassword(req, res) {
	try {
		if (!accountInfoCollection) return res.status(503).json({ success: false, message: "Database not ready" });
		const { name, currentPassword, newPassword } = req.body || {};
		const trimmed = String(name ?? "").trim();

		if (!trimmed || !currentPassword || !newPassword) {
			return res.status(400).json({ success: false, message: "Name, current password, and new password are required" });
		}
		if (String(newPassword).length < 8) {
			return res.status(400).json({ success: false, message: "New password must be at least 8 characters" });
		}

		const user = await findAccountByName(trimmed);
		if (!user) {
			return res.status(404).json({ success: false, message: "Account not found" });
		}

		let valid = false;
		if (!user.password) {
			valid = String(currentPassword) === "12345678";
		} else {
			valid = await bcrypt.compare(String(currentPassword), user.password);
		}
		if (!valid) {
			return res.status(401).json({ success: false, message: "Current password is incorrect" });
		}

		const hashedPassword = await bcrypt.hash(String(newPassword), 10);
		await updateAccountInfoById(user._id, user.name, { $set: { password: hashedPassword } });

		return res.json({ success: true, message: "Password updated successfully" });
	} catch (err) {
		console.error("POST /api/auth/change-password error", err);
		return res.status(500).json({ success: false, message: err.message });
	}
}

/**
 * POST /api/auth/delete-account
 * Body: { name, password, confirmName }
 * Permanently deletes the account and all related user data.
 */
export async function deleteAccount(req, res) {
	try {
		if (!accountInfoCollection) {
			return res.status(503).json({ success: false, message: "Database not ready" });
		}
		const body = req.body || {};
		const name = String(body.name ?? "").trim();
		const password = String(body.password ?? "");
		const confirmName = String(body.confirmName ?? "").trim();

		if (!name || !password) {
			return res.status(400).json({
				success: false,
				message: "Name and password are required",
			});
		}
		if (!confirmName || confirmName !== name) {
			return res.status(400).json({
				success: false,
				message: "Type your account name exactly to confirm deletion",
			});
		}

		const user = await findAccountForDelete(name);
		if (!user) {
			return res.status(404).json({ success: false, message: "Account not found" });
		}
		// Require exact canonical name match for the confirm field (already checked),
		// but resolve account case-insensitively for lookup.
		if (String(user.name) !== name) {
			return res.status(400).json({
				success: false,
				message: `Type your account name exactly as "${user.name}"`,
			});
		}

		let valid = false;
		if (!user.password) {
			valid = password === "12345678";
		} else {
			valid = await bcrypt.compare(password, user.password);
		}
		if (!valid) {
			return res.status(401).json({ success: false, message: "Password is incorrect" });
		}

		const summary = await wipeAccountData({ name: user.name, accountId: user._id });
		console.log("[auth/delete-account] wiped", user.name, summary);

		return res.json({
			success: true,
			message: "Account and all related data deleted",
			summary,
		});
	} catch (err) {
		console.error("POST /api/auth/delete-account error", err);
		return res.status(500).json({
			success: false,
			message: err.message || "Failed to delete account",
		});
	}
}
