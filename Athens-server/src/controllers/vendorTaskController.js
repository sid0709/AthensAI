/**
 * vendor_tasks serialization shared by Bid Management (/bid-results) and Athens Lens.
 * HTTP CRUD for Bid-Monitor (/vendor/tasks) was removed with that extension.
 */
import { detectJobSource } from "../lib/jobSource.js";

const TASK_STATUSES = new Set(["pending", "done", "skipped"]);

function isoOrNull(value) {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "string" && value.trim()) return value;
	return null;
}

function normalizeRecordingsList(doc, primaryRecording) {
	const fromArray = Array.isArray(doc?.recordings)
		? doc.recordings
				.map((entry) => {
					const storagePath = String(entry?.storagePath || "").trim();
					if (!storagePath) return null;
					return {
						storagePath,
						contentType: entry?.contentType || "video/webm",
						sizeBytes: Number(entry?.sizeBytes || 0) || 0,
						sessionId: entry?.sessionId ? String(entry.sessionId) : null,
						durationSec:
							typeof entry?.durationSec === "number" ? entry.durationSec : null,
						recordedStartAt: isoOrNull(entry?.recordedStartAt),
						recordedEndAt: isoOrNull(entry?.recordedEndAt),
						uploadedAt: isoOrNull(entry?.uploadedAt),
					};
				})
				.filter(Boolean)
		: [];
	if (fromArray.length > 0) return fromArray;
	if (primaryRecording?.storagePath) {
		return [
			{
				...primaryRecording,
				durationSec:
					typeof doc?.recordingDurationSec === "number" ? doc.recordingDurationSec : null,
				recordedStartAt: isoOrNull(doc?.recordingStartedAt),
				recordedEndAt: isoOrNull(doc?.recordingEndedAt),
				uploadedAt: null,
			},
		];
	}
	return [];
}

function normalizeResumeAuditsList(doc) {
	const fromArray = Array.isArray(doc?.resumeAudits)
		? doc.resumeAudits
				.map((entry) => {
					const originalName = String(entry?.originalName || "").trim();
					if (!originalName) return null;
					return {
						originalName,
						expectedName: entry?.expectedName ? String(entry.expectedName) : null,
						cleanedName: entry?.cleanedName ? String(entry.cleanedName) : null,
						renamed: Boolean(entry?.renamed),
						mismatch: Boolean(entry?.mismatch),
						sessionId: entry?.sessionId ? String(entry.sessionId) : null,
						source: entry?.source ? String(entry.source) : null,
						fileSize:
							typeof entry?.fileSize === "number" ? entry.fileSize : null,
						mimeType: entry?.mimeType ? String(entry.mimeType) : null,
						auditKey: entry?.auditKey ? String(entry.auditKey) : null,
						recordedAt: isoOrNull(entry?.recordedAt),
					};
				})
				.filter(Boolean)
		: [];
	if (fromArray.length > 0) return fromArray;
	const originalName =
		typeof doc?.resumeOriginalName === "string" ? doc.resumeOriginalName.trim() : "";
	if (!originalName) return [];
	return [
		{
			originalName,
			expectedName:
				typeof doc?.resumeExpectedName === "string" ? doc.resumeExpectedName : null,
			cleanedName:
				typeof doc?.resumeCleanedName === "string" ? doc.resumeCleanedName : null,
			renamed: Boolean(doc?.resumeRenamed),
			mismatch: Boolean(doc?.resumeMismatch),
			sessionId:
				typeof doc?.resumeAuditSessionId === "string" ? doc.resumeAuditSessionId : null,
			source:
				typeof doc?.resumeAuditSource === "string" ? doc.resumeAuditSource : null,
			fileSize:
				typeof doc?.resumeAuditFileSize === "number" ? doc.resumeAuditFileSize : null,
			mimeType:
				typeof doc?.resumeAuditMimeType === "string" ? doc.resumeAuditMimeType : null,
			auditKey: typeof doc?.resumeAuditKey === "string" ? doc.resumeAuditKey : null,
			recordedAt: isoOrNull(doc?.resumeAuditRecordedAt),
		},
	];
}

export function serializeTask(doc) {
	const applyUrl = doc.applyUrl ?? null;
	const jobSource = detectJobSource(applyUrl);
	let progress = "idle";
	if (doc.status === "done" || doc.recordingPath) progress = "completed";
	else if (doc.status === "skipped") progress = "skipped";
	else if (doc.bidderInProcess) progress = "active";

	const recording = doc.recordingPath
		? {
				storagePath: String(doc.recordingPath),
				contentType: doc.recordingContentType || "video/webm",
				sizeBytes: Number(doc.recordingSize || 0),
				sessionId: doc.bidSessionId || null,
			}
		: null;

	const recordings = normalizeRecordingsList(doc, recording);
	const resumeAudits = normalizeResumeAuditsList(doc);

	const companyRaw = doc.company;
	const company =
		typeof companyRaw === "string"
			? companyRaw
			: companyRaw && typeof companyRaw === "object" && typeof companyRaw.name === "string"
				? companyRaw.name
				: "";

	return {
		id: String(doc._id),
		applierName: doc.applierName ?? null,
		jobId: doc.jobId ?? null,
		title: doc.title ?? "Untitled role",
		company,
		applyUrl,
		source: doc.source ?? jobSource?.label ?? "",
		location: doc.location ?? "",
		workMode: doc.workMode ?? "",
		matchScore: typeof doc.matchScore === "number" ? doc.matchScore : null,
		status: TASK_STATUSES.has(doc.status) ? doc.status : "pending",
		progress,
		jobSource,
		addedAt: doc.addedAt instanceof Date ? doc.addedAt.toISOString() : doc.addedAt ?? null,
		updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt ?? null,
		completedAt:
			doc.completedAt instanceof Date
				? doc.completedAt.toISOString()
				: doc.completedAt ?? null,
		bidReadyDate:
			doc.bidReadyDate instanceof Date
				? doc.bidReadyDate.toISOString()
				: doc.bidReadyDate ?? null,
		recording,
		reviewStatus: doc.reviewStatus || null,
		bidderName: doc.bidderName || null,
		bidderInProcess: Boolean(doc.bidderInProcess),
		bidderInProcessAt:
			doc.bidderInProcessAt instanceof Date
				? doc.bidderInProcessAt.toISOString()
				: doc.bidderInProcessAt ?? null,
		recordingDurationSec:
			typeof doc.recordingDurationSec === "number" ? doc.recordingDurationSec : null,
		recordingStartedAt:
			doc.recordingStartedAt instanceof Date
				? doc.recordingStartedAt.toISOString()
				: doc.recordingStartedAt ?? null,
		recordingEndedAt:
			doc.recordingEndedAt instanceof Date
				? doc.recordingEndedAt.toISOString()
				: doc.recordingEndedAt ?? null,
		biddingDurationSec:
			typeof doc.biddingDurationSec === "number" ? doc.biddingDurationSec : null,
		flags: doc.flags && typeof doc.flags === "object" ? doc.flags : null,
		analysisSummary:
			typeof doc.analysisSummary === "string" ? doc.analysisSummary : null,
		analysisFormAnswers: Array.isArray(doc.analysisFormAnswers)
			? doc.analysisFormAnswers
			: [],
		analysisMode:
			doc.analysisMode === "llm"
				? "llm"
				: doc.analysisMode === "heuristic"
					? "heuristic"
					: null,
		analysisPageUrl:
			typeof doc.analysisPageUrl === "string" ? doc.analysisPageUrl : null,
		analysisPageTitle:
			typeof doc.analysisPageTitle === "string" ? doc.analysisPageTitle : null,
		analysisUsage:
			doc.analysisUsage && typeof doc.analysisUsage === "object"
				? doc.analysisUsage
				: null,
		analysisRequestId:
			typeof doc.analysisRequestId === "string" ? doc.analysisRequestId : null,
		analyzedAt:
			doc.analyzedAt instanceof Date ? doc.analyzedAt.toISOString() : doc.analyzedAt ?? null,
		flagAnalysisMode:
			doc.flagAnalysisMode === "llm"
				? "llm"
				: doc.flagAnalysisMode === "heuristic"
					? "heuristic"
					: null,
		flagAnalysisUsage:
			doc.flagAnalysisUsage && typeof doc.flagAnalysisUsage === "object"
				? doc.flagAnalysisUsage
				: null,
		flagAnalysisRequestId:
			typeof doc.flagAnalysisRequestId === "string" ? doc.flagAnalysisRequestId : null,
		flagAnalyzedAt:
			doc.flagAnalyzedAt instanceof Date
				? doc.flagAnalyzedAt.toISOString()
				: doc.flagAnalyzedAt ?? null,
		rejectReason: typeof doc.rejectReason === "string" ? doc.rejectReason : null,
		rejectSource:
			doc.rejectSource === "submitted" || doc.rejectSource === "skipped"
				? doc.rejectSource
				: null,
		rejectCount: Number(doc.rejectCount || 0) || 0,
		resubmitCount: Number(doc.resubmitCount || 0) || 0,
		lastRejectedAt:
			doc.lastRejectedAt instanceof Date
				? doc.lastRejectedAt.toISOString()
				: doc.lastRejectedAt ?? null,
		lastResubmittedAt:
			doc.lastResubmittedAt instanceof Date
				? doc.lastResubmittedAt.toISOString()
				: doc.lastResubmittedAt ?? null,
		resumeOriginalName:
			typeof doc.resumeOriginalName === "string" ? doc.resumeOriginalName : null,
		resumeExpectedName:
			typeof doc.resumeExpectedName === "string" ? doc.resumeExpectedName : null,
		resumeCleanedName:
			typeof doc.resumeCleanedName === "string" ? doc.resumeCleanedName : null,
		resumeRenamed: Boolean(doc.resumeRenamed),
		resumeMismatch: Boolean(doc.resumeMismatch),
		recommendedResumeStack:
			typeof doc.recommendedResumeStack === "string" ? doc.recommendedResumeStack : null,
		recommendedResumeReason:
			typeof doc.recommendedResumeReason === "string" ? doc.recommendedResumeReason : null,
		useCustomizedResume: Boolean(doc.useCustomizedResume),
		recommendWarning:
			typeof doc.recommendWarning === "string" ? doc.recommendWarning : null,
		recommendedAt:
			doc.recommendedAt instanceof Date
				? doc.recommendedAt.toISOString()
				: doc.recommendedAt ?? null,
		recommendMode:
			doc.recommendMode === "llm"
				? "llm"
				: doc.recommendMode === "heuristic"
					? "heuristic"
					: null,
		recommendUsage:
			doc.recommendUsage && typeof doc.recommendUsage === "object"
				? doc.recommendUsage
				: null,
		recommendRequestId:
			typeof doc.recommendRequestId === "string" ? doc.recommendRequestId : null,
		resumeStackMatch:
			doc.resumeStackMatch === "match" ||
			doc.resumeStackMatch === "mismatch" ||
			doc.resumeStackMatch === "unknown"
				? doc.resumeStackMatch
				: null,
		recordings,
		resumeAudits,
	};
}
