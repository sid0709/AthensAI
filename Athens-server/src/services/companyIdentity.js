import { createHash, randomUUID } from "node:crypto";

export const COMPANY_IDENTITY_VERSION = 1;

const SHARED_JOB_HOSTS = new Set([
	"ashbyhq.com",
	"applytojob.com",
	"bamboohr.com",
	"facebook.com",
	"glassdoor.com",
	"greenhouse.io",
	"icims.com",
	"indeed.com",
	"instagram.com",
	"lever.co",
	"linkedin.com",
	"monster.com",
	"jobright.ai",
	"jobvite.com",
	"myworkdayjobs.com",
	"recruitee.com",
	"smartrecruiters.com",
	"teamtailor.com",
	"twitter.com",
	"wellfound.com",
	"workable.com",
	"workday.com",
	"x.com",
	"ziprecruiter.com",
]);

const UNKNOWN_COMPANY_NAMES = new Set([
	"confidential",
	"n a",
	"na",
	"not available",
	"unknown",
]);

const resolutionCache = new Map();
const RESOLUTION_CACHE_MAX = 20_000;
const RESOLUTION_CACHE_TTL_MS = 60_000;

function digest(value, length = 24) {
	return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function cacheSet(key, value) {
	if (!key) return;
	resolutionCache.delete(key);
	resolutionCache.set(key, { value, expiresAt: Date.now() + RESOLUTION_CACHE_TTL_MS });
	while (resolutionCache.size > RESOLUTION_CACHE_MAX) {
		resolutionCache.delete(resolutionCache.keys().next().value);
	}
}

export function clearCompanyIdentityCache() {
	resolutionCache.clear();
}

/** Conservative normalization: exact text only, without fuzzy/suffix merging. */
export function normalizeCompanyName(value) {
	const normalized = String(value ?? "")
		.normalize("NFKC")
		.trim()
		.toLocaleLowerCase("en-US")
		.replace(/&/gu, " and ")
		.replace(/[\p{P}\p{S}]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
	return UNKNOWN_COMPANY_NAMES.has(normalized) ? "" : normalized;
}

function registrableHost(hostname) {
	const labels = hostname.split(".").filter(Boolean);
	if (labels.length <= 2) return hostname;
	const suffix2 = labels.slice(-2).join(".");
	const suffix3 = labels.slice(-3).join(".");
	if (/\.(co|com|org|net|gov|edu)\.[a-z]{2}$/i.test(suffix3)) return suffix3;
	return suffix2;
}

export function extractCompanyDomain(value) {
	const raw = String(value ?? "").trim();
	if (!raw) return null;
	try {
		const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
		const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
		if (!hostname || hostname === "localhost" || !hostname.includes(".")) return null;
		const domain = registrableHost(hostname);
		if ([...SHARED_JOB_HOSTS].some((shared) => domain === shared || domain.endsWith(`.${shared}`))) {
			return null;
		}
		return domain;
	} catch {
		return null;
	}
}

export function companyAliasId(kind, normalizedValue) {
	return digest(`${kind}\0${normalizedValue}`, 40);
}

export function companyIdFor(kind, normalizedValue) {
	return `cmp_${digest(`${kind}\0${normalizedValue}`)}`;
}

function companyNameFromJob(job) {
	return typeof job?.company === "string"
		? job.company
		: job?.company?.name ?? job?.companyName ?? "";
}

function unknownSeed(job, explicitSeed) {
	return explicitSeed || job?._id || job?.id || job?.applyLink || job?.url || randomUUID();
}

/** Side-effect-free fallback used while old jobs are being backfilled. */
export function deriveCompanyIdentity(job, { seed } = {}) {
	const name = String(companyNameFromJob(job) ?? "").trim();
	const normalizedName = normalizeCompanyName(name);
	const domain = extractCompanyDomain(job?.companyLink);
	const kind = domain ? "domain" : normalizedName ? "name" : "unknown";
	const normalizedValue = domain || normalizedName || String(unknownSeed(job, seed));
	return {
		companyId: companyIdFor(kind, normalizedValue),
		companyNameNormalized: normalizedName,
		...(domain ? { companyDomain: domain } : {}),
		companyIdentitySource: kind,
		companyIdentityVersion: COMPANY_IDENTITY_VERSION,
	};
}

async function readAlias(collection, kind, value) {
	if (!collection || !value) return null;
	const key = `${kind}:${value}`;
	const cached = resolutionCache.get(key);
	if (cached?.expiresAt > Date.now()) return cached.value;
	resolutionCache.delete(key);
	const alias = await collection.findOne(
		{ _id: companyAliasId(kind, value) },
		{ projection: { companyId: 1, kind: 1, normalizedValue: 1 } },
	);
	if (alias?.companyId) cacheSet(key, alias);
	return alias || null;
}

async function createAlias(collection, { kind, value, companyId, now }) {
	if (!collection || !value || !companyId) return;
	const id = companyAliasId(kind, value);
	await collection.updateOne(
		{ _id: id },
		{
			$setOnInsert: {
				companyId,
				kind,
				normalizedValue: value,
				createdAt: now,
			},
			$set: { updatedAt: now },
		},
		{ upsert: true },
	);
	const persisted = await collection.findOne({ _id: id }, { projection: { companyId: 1, kind: 1, normalizedValue: 1 } });
	if (persisted?.companyId) cacheSet(`${kind}:${value}`, persisted);
}

/** Resolve and persist canonical employer identity without moving the job document. */
export async function resolveCompanyIdentity(job, {
	companiesCollection,
	companyAliasesCollection,
	seed,
	persist = true,
} = {}) {
	const derived = deriveCompanyIdentity(job, { seed });
	if (!persist || !companiesCollection || !companyAliasesCollection) return derived;

	const name = String(companyNameFromJob(job) ?? "").trim();
	const normalizedName = derived.companyNameNormalized;
	const domain = derived.companyDomain || null;
	const [domainAlias, nameAlias] = await Promise.all([
		readAlias(companyAliasesCollection, "domain", domain),
		readAlias(companyAliasesCollection, "name", normalizedName),
	]);

	// A trusted website domain is authoritative when existing aliases disagree.
	const existing = domainAlias || nameAlias;
	const companyId = existing?.companyId || derived.companyId;
	const source = domainAlias ? "domain" : nameAlias ? "name" : derived.companyIdentitySource;
	const now = new Date().toISOString();
	const logo = typeof job?.company?.logo === "string" ? job.company.logo.trim() : "";
	const companyLink = typeof job?.companyLink === "string" ? job.companyLink.trim() : "";

	await companiesCollection.updateOne(
		{ _id: companyId },
		{
			$setOnInsert: {
				canonicalName: name || "Unknown",
				normalizedName,
				createdAt: now,
				identityVersion: COMPANY_IDENTITY_VERSION,
			},
			$set: {
				updatedAt: now,
				...(domain ? { domain } : {}),
				...(companyLink ? { websiteUrl: companyLink } : {}),
				...(logo ? { logoUrl: logo } : {}),
			},
		},
		{ upsert: true },
	);

	if (domain) await createAlias(companyAliasesCollection, { kind: "domain", value: domain, companyId, now });
	if (normalizedName) await createAlias(companyAliasesCollection, { kind: "name", value: normalizedName, companyId, now });

	return {
		...derived,
		companyId,
		companyIdentitySource: source,
		...(domainAlias && nameAlias && domainAlias.companyId !== nameAlias.companyId
			? { companyIdentityConflict: true }
			: {}),
	};
}

export function applyCompanyIdentity(job, identity) {
	if (!job || !identity) return job;
	for (const field of [
		"companyId",
		"companyNameNormalized",
		"companyDomain",
		"companyIdentitySource",
		"companyIdentityVersion",
		"companyIdentityConflict",
	]) {
		if (identity[field] !== undefined) job[field] = identity[field];
	}
	return job;
}

export const companyIdentityTest = { SHARED_JOB_HOSTS };
