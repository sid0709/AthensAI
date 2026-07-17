import { accountInfoCollection, accountInfoCloudCollection, isCloudMirrorConfigured } from "../db/mongo.js";

function cloudEnabled() {
	return Boolean(accountInfoCloudCollection);
}

async function mirrorCloud(label, operation) {
	if (isCloudMirrorConfigured() && !cloudEnabled()) {
		throw new Error(
			"Cloud MongoDB mirror is configured (MONGO_CLOUD_URL) but not connected. account_info was saved locally only — restart lancer-backend after fixing cloud access.",
		);
	}
	if (!cloudEnabled()) return;
	try {
		await operation();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[account_info] cloud mirror ${label} failed:`, message);
		throw new Error(`Local write succeeded but cloud mirror failed: ${message}`);
	}
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Same case-insensitive name resolution as local findAccountByApplierName. */
async function findCloudAccountByName(nameRaw, projection = { _id: 1, name: 1 }) {
	if (!accountInfoCloudCollection) return null;
	const trimmed = String(nameRaw ?? "").trim();
	if (!trimmed) return null;

	let acc = await accountInfoCloudCollection.findOne({ name: trimmed }, { projection });
	if (acc) return acc;

	const esc = escapeRegExp(trimmed);
	acc = await accountInfoCloudCollection.findOne(
		{ name: { $regex: new RegExp(`^${esc}$`, "i") } },
		{ projection },
	);
	return acc || null;
}

/** Insert into local `account_info`, then mirror to cloud. */
export async function insertAccountInfo(doc) {
	const result = await accountInfoCollection.insertOne(doc);
	await mirrorCloud("insertOne", async () => {
		const existing = await findCloudAccountByName(doc.name);
		if (existing) {
			await accountInfoCloudCollection.updateOne({ _id: existing._id }, { $set: doc });
			return;
		}
		await accountInfoCloudCollection.insertOne({ ...doc });
	});
	return result;
}

/** Delete by applier name on local, then cloud (case-insensitive name match). */
export async function deleteAccountInfoByName(name) {
	const result = await accountInfoCollection.deleteOne({ name });
	if (result.deletedCount > 0) {
		await mirrorCloud("deleteOne", async () => {
			const cloudAcc = await findCloudAccountByName(name, { _id: 1 });
			if (cloudAcc) {
				await accountInfoCloudCollection.deleteOne({ _id: cloudAcc._id });
			}
		});
	}
	return result;
}

/**
 * Update local by `_id`, mirror to cloud by resolved cloud `_id` (names may differ in casing).
 */
export async function updateAccountInfoById(accountId, accountName, update) {
	const result = await accountInfoCollection.updateOne({ _id: accountId }, update);
	if (result.matchedCount > 0 && accountName) {
		await mirrorCloud("updateOne", async () => {
			const cloudAcc = await findCloudAccountByName(accountName, { _id: 1, name: 1 });
			if (cloudAcc) {
				const cloudResult = await accountInfoCloudCollection.updateOne({ _id: cloudAcc._id }, update);
				if (cloudResult.matchedCount === 0) {
					throw new Error(`Cloud account "${accountName}" disappeared during mirror`);
				}
				return;
			}
			// No cloud row yet — create one aligned to the local applier name.
			await accountInfoCloudCollection.updateOne({ name: accountName }, update, { upsert: true });
		});
	}
	return result;
}
