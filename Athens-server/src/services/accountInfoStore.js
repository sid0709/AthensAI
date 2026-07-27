import { accountInfoCollection } from "../db/dataStore.js";
import { invalidateApplierContextCache } from "./jobListQuery.js";

export async function insertAccountInfo(doc) {
	const result = await accountInfoCollection.insertOne(doc);
	await invalidateApplierContextCache(doc?.name);
	return result;
}

export async function deleteAccountInfoByName(name) {
	const result = await accountInfoCollection.deleteOne({ name });
	await invalidateApplierContextCache(name);
	return result;
}

export async function updateAccountInfoById(accountId, accountName, update) {
	const result = await accountInfoCollection.updateOne({ _id: accountId }, update);
	await Promise.all([
		invalidateApplierContextCache(accountName),
		invalidateApplierContextCache(update?.$set?.name),
	]);
	return result;
}
