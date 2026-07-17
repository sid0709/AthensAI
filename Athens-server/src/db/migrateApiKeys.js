import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { encryptSecret, isEncryptedSecret } from '@nextoffer/shared/secretCrypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const API_KEY_FIELDS = ['openaiApiKey', 'deepseekApiKey'];

async function migrateCollection(accountInfoCollection, label) {
	const docs = await accountInfoCollection
		.find({ autoBidProfile: { $exists: true } })
		.toArray();

	let updated = 0;
	for (const doc of docs) {
		const profile = doc.autoBidProfile && typeof doc.autoBidProfile === 'object' ? doc.autoBidProfile : null;
		if (!profile) continue;

		const $set = {};
		const $unset = {};
		let changed = false;

		for (const field of API_KEY_FIELDS) {
			const value = String(profile[field] ?? '').trim();
			if (!value || isEncryptedSecret(value)) continue;
			$set[`autoBidProfile.${field}`] = encryptSecret(value);
			changed = true;
		}

		if (Object.prototype.hasOwnProperty.call(profile, 'openaiModel')) {
			$unset['autoBidProfile.openaiModel'] = '';
			changed = true;
		}

		if (!changed) continue;

		const update = {};
		if (Object.keys($set).length) update.$set = $set;
		if (Object.keys($unset).length) update.$unset = $unset;

		await accountInfoCollection.updateOne({ _id: doc._id }, update);
		updated += 1;
		console.log(`[${label}] migrated API keys for: ${doc.name}`);
	}

	return updated;
}

async function migrateApiKeys() {
	const mongoUrl = process.env.MONGO_URL;
	const mongoDbName = process.env.MONGO_DB || 'AthensDB';
	if (!mongoUrl) {
		throw new Error('MONGO_URL is required');
	}
	if (!process.env.API_KEYS_ENCRYPTION_KEY?.trim()) {
		throw new Error('API_KEYS_ENCRYPTION_KEY is required. Generate one with: openssl rand -hex 32');
	}

	const client = new MongoClient(mongoUrl);
	let cloudClient;

	try {
		await client.connect();
		console.log('Connected to local MongoDB for API key migration');

		const db = client.db(mongoDbName);
		const localUpdated = await migrateCollection(db.collection('account_info'), 'local');
		console.log(`Local migration complete. Updated ${localUpdated} account(s).`);

		const cloudUrl = process.env.MONGO_CLOUD_URL?.trim();
		if (cloudUrl) {
			cloudClient = new MongoClient(cloudUrl);
			await cloudClient.connect();
			console.log('Connected to cloud MongoDB for API key migration');
			const cloudDb = cloudClient.db(mongoDbName);
			const cloudUpdated = await migrateCollection(cloudDb.collection('account_info'), 'cloud');
			console.log(`Cloud migration complete. Updated ${cloudUpdated} account(s).`);
		} else {
			console.log('MONGO_CLOUD_URL not set — cloud mirror skipped');
		}
	} catch (err) {
		console.error('API key migration failed:', err);
		process.exitCode = 1;
	} finally {
		await client.close().catch(() => {});
		if (cloudClient) await cloudClient.close().catch(() => {});
		console.log('MongoDB connection(s) closed.');
	}
}

migrateApiKeys();
