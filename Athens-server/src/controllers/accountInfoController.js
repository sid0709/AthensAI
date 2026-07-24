import bcrypt from "bcrypt";
import { accountInfoCollection } from "../db/mongo.js";
import {
	deleteAccountInfoByName,
	insertAccountInfo,
	updateAccountInfoById,
} from "../services/accountInfoStore.js";
import { decryptAccountDoc } from "../services/autoBidProfileSecrets.js";

export const getAuthSession = async (req, res) => {
	if (!req.auth) {
		return res.status(401).json({ success: false, message: "Authentication required" });
	}
	const grants = Array.isArray(req.profileAccess?.grants) ? req.profileAccess.grants : [];
	const primary = grants.find((grant) => grant.primary) || grants[0] || null;
	return res.json({
		success: true,
		user: {
			_id: req.auth.uid,
			uid: req.auth.uid,
			email: req.auth.email || null,
			name: primary?.profileName || primary?.applierName || req.auth.name || req.auth.email || req.auth.uid,
			profileId: primary?.profileId || null,
			role: req.auth.role || "owner",
			permission: req.auth.admin === true ? "admin" : req.auth.role || "owner",
		},
		profiles: grants,
	});
};

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

/** Strip secrets before returning account docs to clients. */
function tokenIsAdmin(req) {
	return req.auth?.admin === true || String(req.auth?.role || "").toLowerCase() === "admin";
}

function canAccessAccount(req, doc) {
	if (tokenIsAdmin(req)) return true;
	const id = String(doc?._id || "");
	const name = String(doc?.name || "").trim().toLowerCase();
	return req.profileAccess?.profileIds?.has(id) || req.profileAccess?.profileNames?.has(name) || false;
}

async function sanitizeAccount(doc, { includeSecrets = false } = {}) {
	if (!doc) return doc;
	const { password, vendorPassword, ...rest } = doc;
	if (includeSecrets) return decryptAccountDoc(rest);
	const safe = { ...rest };
	if (safe.autoBidProfile && typeof safe.autoBidProfile === "object") {
		safe.autoBidProfile = { ...safe.autoBidProfile };
		for (const field of ["openaiApiKey", "deepseekApiKey", "gmailPassword", "gmailAppPassword", "defaultPassword"]) delete safe.autoBidProfile[field];
	}
	return safe;
}

export const getAccountInfo = async (req, res) => {
	try {
		console.log('GET /api/account_info - Fetching all account info');
		const accountInfo = (await accountInfoCollection.find({}).toArray()).filter((doc) => canAccessAccount(req, doc));
		const includeSecrets = tokenIsAdmin(req) || String(req.auth?.role || "").toLowerCase() === "owner";
		const sanitized = await Promise.all(accountInfo.map((doc) => sanitizeAccount(doc, { includeSecrets })));
		res.status(200).json(sanitized);
	} catch (error) {
		console.error('Error in getAccountInfo:', error);
		res.status(500).json({ message: error.message });
	}
};

/** Single account by `name` (URL-encoded), password stripped. Used by Fox extension profile picker. */
export const getAccountInfoByName = async (req, res) => {
	try {
		const raw = req.params.name;
		const name = typeof raw === "string" ? decodeURIComponent(raw) : "";
		const trimmed = name.trim();
		if (!trimmed) {
			return res.status(400).json({ success: false, message: "Name is required" });
		}
		const doc =
			(await accountInfoCollection.findOne({ name: trimmed })) ||
			(await accountInfoCollection.findOne({
				name: { $regex: new RegExp(`^${escapeRegExp(trimmed)}$`, "i") },
			}));
		if (!doc) {
			return res.status(404).json({ success: false, message: "Account not found" });
		}
		if (!canAccessAccount(req, doc)) return res.status(403).json({ success: false, message: "Profile access denied" });
		const includeSecrets = tokenIsAdmin(req) || String(req.auth?.role || "").toLowerCase() === "owner";
		res.status(200).json({ success: true, data: await sanitizeAccount(doc, { includeSecrets }) });
	} catch (error) {
		console.error("Error in getAccountInfoByName:", error);
		res.status(500).json({ success: false, message: error.message });
	}
};

export const addAccountInfo = async (req, res) => {
	try {
		const { name, password } = req.body;
		console.log('POST /api/account_info - Attempting to add name:', name);
		if (!name) {
			console.log('POST /api/account_info - Name is required (400)');
			return res.status(400).json({ message: "Name is required" });
		}
		// Check if the name already exists to prevent duplicates
		const existingName = await accountInfoCollection.findOne({ name });
		if (existingName) {
			console.log('POST /api/account_info - Name already exists (409):', name);
			return res.status(409).json({ message: "Name already exists" });
		}

		// Hash password if provided
		let hashedPassword = null;
		if (password) {
			hashedPassword = await bcrypt.hash(password, 10);
		}

		const userData = { name };
		if (hashedPassword) {
			userData.password = hashedPassword;
		}

		const result = await insertAccountInfo({ 
			name, 
			password: hashedPassword 
		});

		console.log('POST /api/auth/signup - User created successfully:', name);
		const createdUser = await accountInfoCollection.findOne({ _id: result.insertedId });
		res.status(201).json({ 
			success: true, 
			user: {
				_id: result.insertedId,
				name,
				tier: createdUser ? createdUser.tier : null,
				permission: createdUser?.permission || null,
			},
			message: "User created successfully" 
		});
	} catch (error) {
		console.error('Error in signup:', error);
		res.status(500).json({ success: false, message: error.message });
	}
};

export const signin = async (req, res) => {
	try {
		const { name, password } = req.body;
		console.log('POST /api/auth/signin - Attempting to signin:', name);
		
		if (!name || !password) {
			return res.status(400).json({ success: false, message: "Name and password are required" });
		}

		// Find user by name
		const user = await accountInfoCollection.findOne({ name });
		if (!user) {
			return res.status(401).json({ success: false, message: "Invalid credentials" });
		}

		// Check if user has a password set
		if (!user.password) {
			// For users without password, check against default password
			const defaultPassword = "12345678";
			if (password !== defaultPassword) {
				return res.status(401).json({ success: false, message: "Invalid credentials" });
			}
		} else {
			// Verify password
			const isValid = await bcrypt.compare(password, user.password);
			if (!isValid) {
				return res.status(401).json({ success: false, message: "Invalid credentials" });
			}
		}

		console.log('POST /api/auth/signin - User signed in successfully:', name);
		res.status(200).json({
		success: true,
		user: {
			_id: user._id,
			name: user.name,
			tier: user.tier,
			permission: user.permission || null,
		},
		message: "Signed in successfully"
	});
	} catch (error) {
		console.error('Error in signin:', error);
		res.status(500).json({ success: false, message: error.message });
	}
};

/**
 * Bid Monitor / vendor bidder login.
 * Requires: vendorAllowed ON + vendorPassword set + name+password match.
 * Does NOT accept the Athens owner account password.
 */
export const bidderSignin = async (req, res) => {
	try {
		const name = String(req.body?.name ?? "").trim();
		const password = String(req.body?.password ?? "");
		if (!name || !password) {
			return res.status(400).json({
				success: false,
				code: "MISSING_CREDENTIALS",
				message: "Profile name and vendor access password are required",
			});
		}

		const user = await findAccountByName(name);
		if (!user) {
			return res.status(401).json({
				success: false,
				code: "INVALID_CREDENTIALS",
				message: "Invalid profile name or password",
			});
		}

		if (!user.vendorAllowed) {
			return res.status(403).json({
				success: false,
				code: "VENDOR_ACCESS_OFF",
				message:
					"Vendor access is off for this profile. Turn it on in Athens → Settings → Profile.",
			});
		}

		if (!user.vendorPassword) {
			return res.status(403).json({
				success: false,
				code: "VENDOR_PASSWORD_UNSET",
				message:
					"Vendor access password is not set. Set it in Athens → Settings → Profile.",
			});
		}

		const isValid = await bcrypt.compare(password, user.vendorPassword);
		if (!isValid) {
			return res.status(401).json({
				success: false,
				code: "INVALID_CREDENTIALS",
				message: "Invalid profile name or password",
			});
		}

		return res.status(200).json({
			success: true,
			message: "Signed in successfully",
			user: { _id: user._id, name: user.name, tier: user.tier || null },
		});
	} catch (error) {
		console.error("Error in bidderSignin:", error);
		return res.status(500).json({ success: false, message: error.message });
	}
};

/**
 * Set or clear the vendor-purpose password used by Bid Monitor bidders.
 * Body: { applierName, vendorPassword } or { applierName, clear: true }
 */
export const setVendorPassword = async (req, res) => {
	try {
		if (!accountInfoCollection) {
			return res.status(503).json({ success: false, message: "Database not ready" });
		}
		const applierName = String(req.body?.applierName ?? req.body?.name ?? "").trim();
		const clear = req.body?.clear === true || req.body?.clear === "true";
		const vendorPassword = String(req.body?.vendorPassword ?? "");

		if (!applierName) {
			return res.status(400).json({ success: false, message: "applierName is required" });
		}

		const user = await findAccountByName(applierName);
		if (!user) {
			return res.status(404).json({ success: false, message: "Account not found" });
		}

		if (clear) {
			await updateAccountInfoById(user._id, user.name, { $unset: { vendorPassword: "" } });
			return res.json({
				success: true,
				vendorPasswordSet: false,
				message: "Vendor access password cleared",
			});
		}

		if (vendorPassword.length < 8) {
			return res.status(400).json({
				success: false,
				message: "Vendor access password must be at least 8 characters",
			});
		}

		const hashed = await bcrypt.hash(vendorPassword, 10);
		await updateAccountInfoById(user._id, user.name, { $set: { vendorPassword: hashed } });
		return res.json({
			success: true,
			vendorPasswordSet: true,
			message: "Vendor access password updated",
		});
	} catch (error) {
		console.error("Error in setVendorPassword:", error);
		return res.status(500).json({ success: false, message: error.message });
	}
};

export const removeAccountInfo = async (req, res) => {
	try {
		const { name } = req.params;
		console.log('DELETE /api/account_info/:name - Attempting to remove name:', name);
		if (!name) {
			console.log('DELETE /api/account_info/:name - Name is required (400)');
			return res.status(400).json({ message: "Name is required" });
		}
		const result = await deleteAccountInfoByName(name);
		if (result.deletedCount === 0) {
			console.log('DELETE /api/account_info/:name - Name not found (404):', name);
			return res.status(404).json({ message: "Name not found" });
		}
		console.log('DELETE /api/account_info/:name - Name removed successfully:', name, 'Result:', result);
		res.status(200).json({ message: "Name removed successfully" });
	} catch (error) {
		console.error('Error in removeAccountInfo:', error);
		res.status(500).json({ message: error.message });
	}
};

export const signup = async (req, res) => {
	try {
		const { name, password } = req.body;
		console.log('POST /api/auth/signup - Attempting to signup:', name);

		if (!name || !password) {
			return res.status(400).json({ success: false, message: "Name and password are required" });
		}

		// Check if the name already exists
		const existingUser = await accountInfoCollection.findOne({ name });
		if (existingUser) {
			return res.status(409).json({ success: false, message: "User already exists" });
		}

		// Hash password
		const hashedPassword = await bcrypt.hash(password, 10);

		const result = await insertAccountInfo({
			name,
			password: hashedPassword,
		});

		console.log('POST /api/auth/signup - User created successfully:', name);
		const createdUser = await accountInfoCollection.findOne({ _id: result.insertedId });
		res.status(201).json({
			success: true,
			user: {
				_id: result.insertedId,
				name,
				tier: createdUser ? createdUser.tier : null,
				permission: createdUser?.permission || null,
			},
			message: "User created successfully",
		});
	} catch (error) {
		console.error('Error in signup:', error);
		res.status(500).json({ success: false, message: error.message });
	}
};
