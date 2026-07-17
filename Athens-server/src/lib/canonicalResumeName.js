/**
 * Canonical résumé naming for Bid Ready zip + upload mismatch checks.
 * Pattern: `Company - Title - Profile - shortId`
 */

const WIN_RESERVED = new Set([
	"CON",
	"PRN",
	"AUX",
	"NUL",
	"COM1",
	"COM2",
	"COM3",
	"COM4",
	"COM5",
	"COM6",
	"COM7",
	"COM8",
	"COM9",
	"LPT1",
	"LPT2",
	"LPT3",
	"LPT4",
	"LPT5",
	"LPT6",
	"LPT7",
	"LPT8",
	"LPT9",
]);

const MAX_STEM = 180;

/** Sanitize one path segment for Windows + macOS filenames. */
export function sanitizeResumeSegment(value) {
	let s = String(value ?? "")
		.normalize("NFC")
		.replace(/[\u0000-\u001f\u007f]/g, "")
		.replace(/[\/\\:\*\?"<>\|]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[. ]+$/g, "");

	if (!s) s = "Unknown";
	const upper = s.toUpperCase();
	if (WIN_RESERVED.has(upper)) s = `_${s}`;
	return s;
}

/** Short stable id from Mongo ObjectId / any job id string. */
export function shortJobId(jobId) {
	const raw = String(jobId ?? "").trim();
	if (!raw) return "unknown";
	const alnum = raw.replace(/[^a-zA-Z0-9]/g, "");
	if (!alnum) return "unknown";
	return alnum.length <= 12 ? alnum : alnum.slice(-12);
}

/**
 * Folder + file stem (no extension).
 * Truncates title first so company, profile, and full shortJobId stay intact.
 */
export function buildCanonicalResumeStem(company, title, profileName, jobId) {
	const companySeg = sanitizeResumeSegment(company);
	const profileSeg = sanitizeResumeSegment(profileName);
	const idSeg = shortJobId(jobId);
	const fixed = `${companySeg} -  - ${profileSeg} - ${idSeg}`;
	const budget = Math.max(8, MAX_STEM - fixed.length + 1); // room for title between dashes
	let titleSeg = sanitizeResumeSegment(title);
	if (titleSeg.length > budget) {
		titleSeg = titleSeg.slice(0, budget).replace(/[. ]+$/g, "") || "Role";
	}
	let stem = `${companySeg} - ${titleSeg} - ${profileSeg} - ${idSeg}`;
	if (stem.length > MAX_STEM) {
		stem = stem.slice(0, MAX_STEM).replace(/[. ]+$/g, "");
	}
	return stem;
}

export function buildCanonicalResumeFileName(company, title, profileName, jobId, ext = ".pdf") {
	const stem = buildCanonicalResumeStem(company, title, profileName, jobId);
	const safeExt = String(ext || ".pdf").startsWith(".")
		? String(ext)
		: `.${ext}`;
	return `${stem}${safeExt}`;
}

/** Basename for comparison (case-sensitive). */
export function resumeBasename(name) {
	const s = String(name || "").trim();
	if (!s) return "";
	const parts = s.replace(/\\/g, "/").split("/");
	return parts[parts.length - 1] || "";
}

/**
 * Mismatch = hooked original basename !== expected canonical basename (case-sensitive).
 */
export function isResumeNameMismatch(originalName, expectedName) {
	const a = resumeBasename(originalName);
	const b = resumeBasename(expectedName);
	if (!a || !b) return false;
	return a !== b;
}

/** Profile display name → ATS upload base (spaces stripped). */
export function profileNameToFileBase(applierName) {
	if (!applierName) return null;
	const base = String(applierName).replace(/\s+/g, "").trim();
	return base.length > 0 ? base : null;
}
