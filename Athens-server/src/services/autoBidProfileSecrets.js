import { accountInfoCollection } from '../db/mongo.js';
import {
	decryptProfileApiKeys,
	encryptProfileApiKeys,
} from '@nextoffer/shared/profileApiKeys';

export { decryptProfileApiKeys, encryptProfileApiKeys };

export function decryptAccountDoc(doc) {
	if (!doc?.autoBidProfile) return doc;
	return { ...doc, autoBidProfile: decryptProfileApiKeys(doc.autoBidProfile) };
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Resolve an applier's autoBidProfile with decrypted API keys (exact, then case-insensitive). */
export async function loadDecryptedAutoBidProfile(applierNameRaw, projection = { autoBidProfile: 1 }) {
	const name = String(applierNameRaw ?? '').trim();
	if (!name || !accountInfoCollection) return null;

	let acc = await accountInfoCollection.findOne({ name }, { projection });
	if (!acc) {
		const esc = escapeRegExp(name);
		acc = await accountInfoCollection.findOne(
			{ name: { $regex: new RegExp(`^${esc}$`, 'i') } },
			{ projection },
		);
	}
	if (!acc?.autoBidProfile) return acc?.autoBidProfile || null;
	return decryptProfileApiKeys(acc.autoBidProfile);
}
