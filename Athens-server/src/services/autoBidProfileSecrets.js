import { KeyManagementServiceClient } from '@google-cloud/kms';
import { DocumentId } from '@nextoffer/shared/document-id';
import { accountInfoCollection } from '../db/dataStore.js';
import { decryptSecret as decryptLegacy, encryptSecret as encryptLegacy, isEncryptedSecret } from '@nextoffer/shared/secretCrypto';

const FIELDS = ['openaiApiKey', 'deepseekApiKey', 'gmailPassword', 'gmailAppPassword', 'defaultPassword'];
const PREFIX = 'kms:v1:';
let kmsClient;

function kmsKeyName() { return String(process.env.KMS_KEY_NAME || '').trim(); }
function kms() { kmsClient ||= new KeyManagementServiceClient(); return kmsClient; }

async function encryptValue(value) {
	const text = String(value || '');
	if (!text || text.startsWith(PREFIX) || isEncryptedSecret(text)) return text;
	if (!kmsKeyName()) return encryptLegacy(text);
	const [result] = await kms().encrypt({ name: kmsKeyName(), plaintext: Buffer.from(text) });
	return `${PREFIX}${Buffer.from(result.ciphertext).toString('base64')}`;
}

async function decryptValue(value) {
	const text = String(value || '');
	if (!text) return '';
	if (text.startsWith(PREFIX)) {
		if (!kmsKeyName()) throw new Error('KMS_KEY_NAME is required to decrypt profile secrets');
		const [result] = await kms().decrypt({ name: kmsKeyName(), ciphertext: Buffer.from(text.slice(PREFIX.length), 'base64') });
		return Buffer.from(result.plaintext).toString('utf8');
	}
	return isEncryptedSecret(text) ? decryptLegacy(text) : text;
}

/** Encrypt a non-profile account secret with the same KMS/legacy policy. */
export async function encryptAccountSecret(value) {
	return encryptValue(value);
}

/** Decrypt a non-profile account secret with the same KMS/legacy policy. */
export async function decryptAccountSecret(value) {
	return decryptValue(value);
}

export async function encryptProfileApiKeys(profile) {
	if (!profile || typeof profile !== 'object') return profile;
	const out = { ...profile };
	for (const field of FIELDS) if (typeof out[field] === 'string' && out[field]) out[field] = await encryptValue(out[field]);
	return out;
}

export async function decryptProfileApiKeys(profile) {
	if (!profile || typeof profile !== 'object') return profile;
	const out = { ...profile };
	for (const field of FIELDS) if (typeof out[field] === 'string' && out[field]) out[field] = await decryptValue(out[field]);
	return out;
}

export async function decryptSelectedProfileSecrets(profile, selectedFields) {
	if (!profile || typeof profile !== 'object') return profile;
	const selected = new Set(Array.isArray(selectedFields) ? selectedFields : []);
	const out = { ...profile };
	for (const field of FIELDS) {
		if (typeof out[field] !== 'string' || !out[field]) continue;
		out[field] = selected.has(field) ? await decryptValue(out[field]) : '';
	}
	return out;
}

function isUnavailableKmsError(error) {
	return error?.code === 7 || /KMS_KEY_NAME is required|cloudkms\.cryptoKeyVersions\.useToDecrypt|PERMISSION_DENIED/i.test(
		String(error?.message || error || ''),
	);
}

/**
 * Decrypt secrets for a client-facing profile read without making the whole
 * profile unavailable when this runtime cannot access a KMS-encrypted field.
 * Unavailable values are redacted; callers may surface `unavailableFields`.
 */
export async function decryptProfileApiKeysForClient(profile) {
	if (!profile || typeof profile !== 'object') return { profile, unavailableFields: [] };
	const out = { ...profile };
	const unavailableFields = [];
	for (const field of FIELDS) {
		if (typeof out[field] !== 'string' || !out[field]) continue;
		try {
			out[field] = await decryptValue(out[field]);
		} catch (error) {
			if (!isUnavailableKmsError(error)) throw error;
			out[field] = '';
			unavailableFields.push(field);
		}
	}
	return { profile: out, unavailableFields };
}

/** Preserve ciphertext that a client could not read unless it supplied a replacement. */
export function preserveUnavailableProfileSecrets(profile, storedProfile, unavailableFields = []) {
	const out = { ...(profile || {}) };
	for (const field of unavailableFields) {
		if (FIELDS.includes(field) && !out[field]) out[field] = storedProfile?.[field] || '';
	}
	return out;
}

export async function rewrapProfileSecretsWithKms(profile) {
	if (!kmsKeyName()) throw new Error('KMS_KEY_NAME is required to rewrap migrated profile secrets');
	if (!profile || typeof profile !== 'object') return profile;
	const out = { ...profile };
	for (const field of FIELDS) {
		if (typeof out[field] !== 'string' || !out[field]) continue;
		const plaintext = await decryptValue(out[field]);
		const [result] = await kms().encrypt({ name: kmsKeyName(), plaintext: Buffer.from(plaintext) });
		out[field] = `${PREFIX}${Buffer.from(result.ciphertext).toString('base64')}`;
	}
	return out;
}

export async function decryptAccountDoc(doc) {
	if (!doc?.autoBidProfile) return doc;
	return { ...doc, autoBidProfile: await decryptProfileApiKeys(doc.autoBidProfile) };
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function findAutoBidProfile(applierNameRaw, projection) {
	const name = String(applierNameRaw ?? '').trim();
	if (!name || !accountInfoCollection) return null;
	let acc = await accountInfoCollection.findOne({ name }, { projection });
	if (!acc) acc = await accountInfoCollection.findOne({ name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, 'i') } }, { projection });
	return acc?.autoBidProfile || null;
}

export async function loadDecryptedAutoBidProfile(applierNameRaw, projection = { autoBidProfile: 1 }) {
	const profile = await findAutoBidProfile(applierNameRaw, projection);
	return profile ? decryptProfileApiKeys(profile) : profile;
}

/** Load the reusable profile while decrypting only credentials needed by LLM flows. */
export async function loadLlmAutoBidProfile(applierNameRaw, projection = { autoBidProfile: 1 }) {
	const profile = await findAutoBidProfile(applierNameRaw, projection);
	return profile
		? decryptSelectedProfileSecrets(profile, ['openaiApiKey', 'deepseekApiKey'])
		: profile;
}

/** Prefer the authenticated profile id, then retain name lookup compatibility. */
export async function loadLlmAutoBidProfileForIdentity(
	{ profileId, applierName } = {},
	projection = { autoBidProfile: 1 },
) {
	const id = String(profileId || '').trim();
	if (id && accountInfoCollection && DocumentId.isValid(id)) {
		const account = await accountInfoCollection.findOne(
			{ _id: new DocumentId(id) },
			{ projection },
		);
		if (account?.autoBidProfile) {
			return decryptSelectedProfileSecrets(
				account.autoBidProfile,
				['openaiApiKey', 'deepseekApiKey'],
			);
		}
	}
	return loadLlmAutoBidProfile(applierName, projection);
}
