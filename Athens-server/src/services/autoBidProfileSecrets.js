import { KeyManagementServiceClient } from '@google-cloud/kms';
import { accountInfoCollection } from '../db/mongo.js';
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

export async function loadDecryptedAutoBidProfile(applierNameRaw, projection = { autoBidProfile: 1 }) {
	const name = String(applierNameRaw ?? '').trim();
	if (!name || !accountInfoCollection) return null;
	let acc = await accountInfoCollection.findOne({ name }, { projection });
	if (!acc) acc = await accountInfoCollection.findOne({ name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, 'i') } }, { projection });
	if (!acc?.autoBidProfile) return acc?.autoBidProfile || null;
	return decryptProfileApiKeys(acc.autoBidProfile);
}
