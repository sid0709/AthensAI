/**
 * Compress resumeAnalysisCatalog / resumeCatalog into LLM-friendly text
 * and resolve AI stack labels against catalog keys.
 */

/** Strip .pdf / .docx so "C# + Java.docx" can match "C# + Java". */
export function stripResumeExtension(name) {
	return String(name ?? "")
		.replace(/\.(pdf|docx)$/i, "")
		.trim();
}

export function normalizeResumeLabel(name) {
	return stripResumeExtension(name)
		.toLowerCase()
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Compare upload filename to recommended stack label.
 * @returns {'match'|'mismatch'|'unknown'}
 */
export function matchUploadToRecommended(originalName, recommendedName) {
	if (!originalName?.trim() || !recommendedName?.trim()) return "unknown";
	const upload = normalizeResumeLabel(originalName);
	const recommended = normalizeResumeLabel(recommendedName);
	if (!upload || !recommended) return "unknown";
	if (upload === recommended) return "match";
	if (upload.includes(recommended) || recommended.includes(upload)) return "match";
	return "mismatch";
}

/**
 * Extract skill names from a catalog entry (array of {name} or skill→score map).
 * @param {unknown} entry
 * @returns {string[]}
 */
export function skillNamesFromCatalogEntry(entry) {
	if (Array.isArray(entry)) {
		return entry
			.map((item) => {
				if (typeof item === "string") return item.trim();
				if (item && typeof item === "object" && typeof item.name === "string") {
					return item.name.trim();
				}
				return "";
			})
			.filter(Boolean);
	}
	if (entry && typeof entry === "object") {
		return Object.keys(entry)
			.map((k) => String(k).trim())
			.filter(Boolean);
	}
	return [];
}

/**
 * Compress catalog to plain text without scores/levels.
 * @param {Record<string, unknown>} catalog
 * @returns {{ text: string, stackNames: string[] }}
 */
export function compressResumeCatalog(catalog) {
	if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
		return { text: "", stackNames: [] };
	}

	const stackNames = Object.keys(catalog).filter((k) => String(k).trim());
	const blocks = stackNames.map((stack) => {
		const skills = skillNamesFromCatalogEntry(catalog[stack]);
		const skillLine = skills.length ? skills.join(", ") : "(none)";
		return `Resume: ${stack}\nSkills: ${skillLine}`;
	});

	return {
		text: blocks.join("\n----\n"),
		stackNames,
	};
}

/**
 * Resolve a free-form AI label to an exact catalog key.
 * @param {string|null|undefined} recommended
 * @param {string[]} stackNames
 * @returns {string|null}
 */
export function resolveCatalogKey(recommended, stackNames) {
	const label = String(recommended ?? "").trim();
	if (!label || !Array.isArray(stackNames) || stackNames.length === 0) return null;

	const normalized = normalizeResumeLabel(label);
	if (!normalized) return null;

	for (const key of stackNames) {
		if (normalizeResumeLabel(key) === normalized) return key;
	}
	for (const key of stackNames) {
		const keyNorm = normalizeResumeLabel(key);
		if (keyNorm.includes(normalized) || normalized.includes(keyNorm)) return key;
	}
	return null;
}
