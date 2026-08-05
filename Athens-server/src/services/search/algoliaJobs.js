import { algoliasearch } from "algoliasearch";
import { getFirestoreDb } from "../firebase/firebaseAdmin.js";

let client;
function config() {
	return {
		appId: String(process.env.ALGOLIA_APP_ID || "").trim(),
		apiKey: String(process.env.ALGOLIA_ADMIN_API_KEY || "").trim(),
		indexName: String(process.env.ALGOLIA_JOBS_INDEX || "athens_jobs").trim(),
		latestIndexName: String(process.env.ALGOLIA_JOBS_LATEST_INDEX || process.env.ALGOLIA_JOBS_INDEX || "athens_jobs").trim(),
	};
}
function getClient() {
	const { appId, apiKey } = config();
	if (!appId || !apiKey) return null;
	client ||= algoliasearch(appId, apiKey);
	return client;
}

function record(id, data) {
	return {
		objectID: id,
		title: data.title || "",
		company: typeof data.company === "string" ? data.company : data.company?.name || data.companyName || "",
		description: data.description || data.jobDescription || "",
		source: data.source || "",
		sourceCatalog: data.sourceCatalog || "market",
		postedAt: data.postedAt || data.createdAt || null,
		titleReviewLabel: data.titleReview?.label || "",
		skills: data.skills || data.aiSkills?.map?.((skill) => skill.name) || [],
	};
}

export function isAlgoliaConfigured() {
	const { appId, apiKey } = config();
	return Boolean(appId && apiKey);
}

export async function searchJobIds(query, limit = 5000) {
	const search = getClient();
	if (!search) {
		if (process.env.NODE_ENV === "production") throw new Error("Algolia is required for production job search");
		return null;
	}
	const { indexName } = config();
	const result = await search.searchSingleIndex({ indexName, searchParams: { query: String(query || ""), hitsPerPage: Math.min(5000, limit), attributesToRetrieve: ["objectID"] } });
	return result.hits.map((hit) => String(hit.objectID));
}

/** Search the newest-sorted Algolia replica and return one stable hit page. */
export async function searchNewestJobPage(query, {
	page = 0,
	hitsPerPage = 100,
	facetFilters = null,
} = {}) {
	const search = getClient();
	if (!search) {
		if (process.env.NODE_ENV === "production") throw new Error("Algolia is required for production job search");
		return null;
	}
	const { latestIndexName } = config();
	const searchParams = {
		query: String(query || ""),
		page: Math.max(0, Number(page) || 0),
		hitsPerPage: Math.max(1, Math.min(1000, Number(hitsPerPage) || 100)),
		attributesToRetrieve: ["objectID"],
	};
	if (Array.isArray(facetFilters) && facetFilters.length) {
		searchParams.facetFilters = facetFilters;
	}
	const result = await search.searchSingleIndex({
		indexName: latestIndexName,
		searchParams,
	});
	return {
		ids: result.hits.map((hit) => String(hit.objectID)),
		page: Number(result.page || 0),
		nbPages: Number(result.nbPages || 0),
		nbHits: Number(result.nbHits || 0),
	};
}

export async function processAlgoliaOutbox(limit = 100) {
	const search = getClient();
	if (!search) throw new Error("Algolia configuration is missing");
	const db = getFirestoreDb();
	const snapshot = await db.collection("search_outbox").where("status", "==", "pending").orderBy("createdAt").limit(limit).get();
	let processed = 0;
	for (const outbox of snapshot.docs) {
		const item = outbox.data();
		try {
			const job = await db.collection("jobs").doc(String(item.jobId)).get();
			if (item.operation === "delete" || !job.exists) {
				await search.deleteObject({ indexName: config().indexName, objectID: String(item.jobId) });
			} else {
				await search.saveObject({ indexName: config().indexName, body: record(job.id, job.data()) });
			}
			const completedAt = new Date();
			await outbox.ref.update({
				status: "completed",
				completedAt,
				expiresAt: new Date(completedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
				attempts: Number(item.attempts || 0) + 1,
				error: null,
			});
			processed += 1;
		} catch (error) {
			await outbox.ref.update({ attempts: Number(item.attempts || 0) + 1, error: String(error?.message || error).slice(0, 1000), lastAttemptAt: new Date() });
			throw error;
		}
	}
	return { processed, remaining: snapshot.size === limit };
}

export async function rebuildAlgoliaJobs() {
	const search = getClient();
	if (!search) throw new Error("Algolia configuration is missing");
	const snapshot = await getFirestoreDb().collection("jobs").where("sourceCatalog", "==", "market").get();
	const objects = snapshot.docs.map((doc) => record(doc.id, doc.data()));
	await search.replaceAllObjects({ indexName: config().indexName, objects, waitForTasks: true });
	return { indexed: objects.length };
}
