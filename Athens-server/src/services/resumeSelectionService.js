import fs from "fs/promises";
import path from "path";

/**
 * Tokenize text for loose matching (folder names like "Python + React").
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
	const raw = String(text || "").toLowerCase();
	const parts = raw.split(/[^a-z0-9+#]+/i).filter((p) => p.length >= 2);
	return new Set(parts);
}

/**
 * Score a resume subfolder label against job description + skill hints.
 * Higher is better.
 * @param {string} folderName
 * @param {Set<string>} jobTokens
 */
function scoreFolder(folderName, jobTokens) {
	const fTokens = tokenize(folderName.replace(/\+/g, " "));
	let score = 0;
	for (const t of fTokens) {
		if (jobTokens.has(t)) {
			score += 3;
		}
	}
	// Light bonus when folder string appears as substring (handles "mern", "nodejs" style)
	const compactJob = [...jobTokens].join(" ");
	const fold = folderName.toLowerCase();
	if (compactJob.includes(fold) || fold.split(/\s*\+\s*/).some((chunk) => chunk.length > 3 && compactJob.includes(chunk.toLowerCase()))) {
		score += 2;
	}
	return score;
}

/**
 * List immediate subdirectories of resumeFolderUrl (non-recursive).
 * @param {string} resumeFolderUrl
 * @returns {Promise<string[]>}
 */
async function listSubfolders(resumeFolderUrl) {
	const root = path.normalize(String(resumeFolderUrl || "").trim());
	if (!root) {
		return [];
	}
	let entries;
	try {
		entries = await fs.readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * Pick best subfolder and resolve `${fullName}.pdf` path.
 * @param {{
 *   resumeFolderUrl: string;
 *   fullName: string;
 *   jobDescription?: string;
 *   skills?: string[];
 * }} params
 */
export async function selectResumePdfPath(params) {
	const { resumeFolderUrl, fullName } = params;
	const jobBlob = [
		params.jobDescription || "",
		...(Array.isArray(params.skills) ? params.skills : []).map(String),
	].join(" ");
	const jobTokens = tokenize(jobBlob);

	const folders = await listSubfolders(resumeFolderUrl);
	if (folders.length === 0) {
		const root = path.normalize(String(resumeFolderUrl || "").trim());
		const direct = path.join(root, `${String(fullName || "").trim()}.pdf`);
		try {
			await fs.access(direct);
			return {
				subfolder: "",
				resumePdfPath: direct,
				score: 0,
				candidates: [],
			};
		} catch {
			return { subfolder: "", resumePdfPath: "", score: 0, candidates: [] };
		}
	}

	let best = folders[0];
	let bestScore = scoreFolder(best, jobTokens);
	for (const f of folders.slice(1)) {
		const s = scoreFolder(f, jobTokens);
		if (s > bestScore) {
			bestScore = s;
			best = f;
		}
	}

	const root = path.normalize(String(resumeFolderUrl || "").trim());
	const resumePdfPath = path.join(root, best, `${String(fullName || "").trim()}.pdf`);
	try {
		await fs.access(resumePdfPath);
	} catch {
		return {
			subfolder: best,
			resumePdfPath: "",
			score: bestScore,
			candidates: folders,
			error: `PDF not found at ${resumePdfPath}`,
		};
	}

	return {
		subfolder: best,
		resumePdfPath,
		score: bestScore,
		candidates: folders,
	};
}

/**
 * Read PDF as base64 (for Fox extension upload_semantic).
 * @param {string} absolutePath
 */
export async function readPdfAsBase64(absolutePath) {
	const buf = await fs.readFile(absolutePath);
	return buf.toString("base64");
}
