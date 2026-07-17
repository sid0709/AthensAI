import PizZip from "pizzip";
import { jobsCollection, getVendorTasksCollection } from "../db/mongo.js";
import { ObjectId } from "mongodb";
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
 * Build a zip of generated résumés for Bid Ready jobs.
 * Folder stem === file stem (canonical naming). No size/count limits.
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

	const zip = new PizZip();
	let added = 0;
	const usedStems = new Set();

	for (const jobId of ids) {
		const draft = await resolveAgentJobDraftPdf({ applierName: name, jobId });
		if (!draft?.buffer?.length) continue;

		const meta = await resolveJobMeta(jobId, name);
		let stem = buildCanonicalResumeStem(meta.company, meta.title, name, jobId);
		if (usedStems.has(stem)) {
			stem = `${stem}-${added + 1}`;
		}
		usedStems.add(stem);

		const entryName = `${stem}/${stem}.pdf`;
		zip.file(entryName, draft.buffer);
		added += 1;
	}

	if (added === 0) {
		return {
			ok: false,
			status: 404,
			error: "No generated résumés found for the selected jobs.",
		};
	}

	const buffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
	const safeApplier = name.replace(/[^\w.\-()+ ]+/g, "_").trim() || "resumes";
	return {
		ok: true,
		buffer,
		fileName: `${safeApplier}-bid-resumes.zip`,
		count: added,
	};
}
