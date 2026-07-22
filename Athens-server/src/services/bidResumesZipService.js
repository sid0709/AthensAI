import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { ZipArchive } from "archiver";
import { ObjectId } from "mongodb";
import { jobsCollection, getVendorTasksCollection } from "../db/mongo.js";
import { buildCanonicalResumeStem } from "../lib/canonicalResumeName.js";
import { listBidQueueJobs } from "./jobBidStatusService.js";
import { resolveAgentJobDraftPdf } from "./agentResumeGenService.js";

function companyDisplayName(company) {
	if (typeof company === "string") return company.trim() || "Unknown";
	if (company && typeof company === "object") {
		const name = company.name ?? company.companyName;
		if (typeof name === "string" && name.trim()) return name.trim();
	}
	return "Unknown";
}

async function resolveJobMeta(jobId, applierName) {
	const tasks = getVendorTasksCollection();
	const task = tasks
		? await tasks.findOne({ applierName, jobId: String(jobId) })
		: null;
	if (task?.title || task?.company) {
		return {
			title: task.title || "Untitled role",
			company: companyDisplayName(task.company),
		};
	}
	try {
		const oid = new ObjectId(String(jobId));
		const job = jobsCollection
			? await jobsCollection.findOne(
					{ _id: oid },
					{ projection: { title: 1, company: 1 } },
				)
			: null;
		if (job) {
			return {
				title: job.title || "Untitled role",
				company: companyDisplayName(job.company),
			};
		}
	} catch {
		/* ignore */
	}
	return { title: "Untitled role", company: "Unknown" };
}

/**
 * Build a standard ZIP buffer via archiver (more reliable on Windows Explorer
 * than PizZip nested paths). Flat entries only: `{stem}.pdf` — nested
 * `stem/stem.pdf` paths exceed Windows MAX_PATH and show as "invalid zip".
 */
async function archiveToBuffer(appendEntries) {
	const archive = new ZipArchive({ zlib: { level: 6 } });
	const pass = new PassThrough();
	const chunks = [];
	pass.on("data", (chunk) => chunks.push(chunk));

	let archiveError = null;
	archive.on("error", (err) => {
		archiveError = err;
	});

	archive.pipe(pass);
	await appendEntries(archive);
	await archive.finalize();
	await finished(pass);
	if (archiveError) throw archiveError;
	return Buffer.concat(chunks);
}

/** Run async work over items with a fixed concurrency limit. */
async function mapPool(items, concurrency, worker) {
	const results = new Array(items.length);
	let next = 0;
	const limit = Math.max(1, concurrency);

	async function run() {
		while (next < items.length) {
			const index = next++;
			results[index] = await worker(items[index], index);
		}
	}

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
	return results;
}

/**
 * Build a zip of generated résumés for Bid Ready jobs.
 * Flat canonical filenames (no nested folders) for Windows compatibility.
 */
export async function buildBidResumesZip({ applierName, jobIds }) {
	const name = String(applierName || "").trim();
	if (!name) return { ok: false, status: 400, error: "applierName is required." };

	let ids = Array.isArray(jobIds) ? jobIds.map(String).filter(Boolean) : [];
	if (ids.length === 0) {
		const queue = await listBidQueueJobs(name, { limit: 5000, includeCompleted: false });
		ids = queue.map((j) => String(j.jobId)).filter(Boolean);
	}
	if (ids.length === 0) {
		return { ok: false, status: 404, error: "No Bid Ready jobs to zip." };
	}

	const resolved = await mapPool(ids, 4, async (jobId) => {
		const draft = await resolveAgentJobDraftPdf({ applierName: name, jobId });
		if (!draft?.buffer?.length) return null;
		const meta = await resolveJobMeta(jobId, name);
		return { jobId, buffer: draft.buffer, meta };
	});

	const entries = [];
	const usedStems = new Set();

	for (const item of resolved) {
		if (!item) continue;
		let stem = buildCanonicalResumeStem(
			item.meta.company,
			item.meta.title,
			name,
			item.jobId,
		);
		if (usedStems.has(stem)) {
			stem = `${stem}-${entries.length + 1}`;
		}
		usedStems.add(stem);

		// Flat entry — Windows Explorer rejects long nested stem/stem.pdf paths.
		entries.push({ name: `${stem}.pdf`, buffer: item.buffer });
	}

	if (entries.length === 0) {
		return {
			ok: false,
			status: 404,
			error: "No generated résumés found for the selected jobs.",
		};
	}

	const buffer = await archiveToBuffer(async (archive) => {
		for (const entry of entries) {
			archive.append(entry.buffer, { name: entry.name });
		}
	});

	const safeApplier = name.replace(/[^\w.\-()+ ]+/g, "_").trim() || "resumes";
	return {
		ok: true,
		buffer,
		fileName: `${safeApplier}-bid-resumes.zip`,
		count: entries.length,
	};
}
