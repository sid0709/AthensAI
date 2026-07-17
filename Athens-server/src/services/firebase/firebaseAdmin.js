import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "../../..");

let initError = null;

function resolveCredentialsPath() {
	const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
	if (!raw) return null;
	return path.isAbsolute(raw) ? raw : path.resolve(serverRoot, raw);
}

function loadServiceAccount() {
	const credPath = resolveCredentialsPath();
	if (!credPath) {
		throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set");
	}
	if (!fs.existsSync(credPath)) {
		throw new Error(`Service account file not found: ${credPath}`);
	}
	const raw = fs.readFileSync(credPath, "utf8");
	return JSON.parse(raw);
}

function ensureApp() {
	if (getApps().length > 0) {
		return getApps()[0];
	}

	const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || undefined;
	const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined;

	try {
		const serviceAccount = loadServiceAccount();
		return initializeApp({
			credential: cert(serviceAccount),
			projectId: projectId || serviceAccount.project_id,
			storageBucket,
		});
	} catch (err) {
		// Fall back to ADC if a credentials file path is missing but the runtime
		// already has Google Application Default Credentials.
		try {
			return initializeApp({
				credential: applicationDefault(),
				projectId,
				storageBucket,
			});
		} catch (adcErr) {
			initError = err instanceof Error ? err : new Error(String(err));
			const adcMessage = adcErr instanceof Error ? adcErr.message : String(adcErr);
			throw new Error(`${initError.message} (ADC fallback failed: ${adcMessage})`);
		}
	}
}

export function getFirebaseMeta() {
	const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || null;
	const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim() || null;
	const credPath = resolveCredentialsPath();
	return {
		projectId,
		storageBucket,
		credentialsConfigured: Boolean(credPath && fs.existsSync(credPath)),
		credentialsPath: credPath,
		initError: initError?.message || null,
	};
}

export function getFirestoreDb() {
	ensureApp();
	return getFirestore();
}

export function getStorageBucket() {
	ensureApp();
	const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim();
	const storage = getStorage();
	return bucketName ? storage.bucket(bucketName) : storage.bucket();
}
