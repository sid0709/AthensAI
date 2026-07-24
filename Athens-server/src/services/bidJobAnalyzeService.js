/**
 * Bid job page + Remote/Clearance analysis for Bid-Monitor.
 * AI reads full page innerText (+ optional form hints) and profile JSON — no hardcoded answers.
 */
import { accountInfoCollection } from "../db/mongo.js";
import {
	compressResumeCatalog,
	resolveCatalogKey,
} from "../lib/resumeCatalogCompress.js";
import { chatCompletion, resolveDefaultModel, summarizeUsage } from "./llm/llmService.js";
import { decryptAccountDoc, loadDecryptedAutoBidProfile } from "./autoBidProfileSecrets.js";

const FLAG_KEYWORDS = {
	remote:
		/\b(in[\s-]?person|on[\s-]?site|hybrid|in[\s-]?office|office[\s-]?based|on[\s-]?campus)\b|\b(?:must|required\s+to)\s+relocate\b|\brelocation\s+(?:is\s+)?required\b/i,
	clearance:
		/\b(clearance|fingerprint\w*|polygraph|security[\s-]?clearance|background\s+(?:check|investigation)|secret|ts\/sci)\b/i,
};

const REMOTE_POSITIVE =
	/\b(remote(?:ly)?|work\s+from\s+home|work\s+from\s+anywhere|wfh|telecommut\w*|home[\s-]?based)\b/i;
const REMOTE_DENIAL =
	/\b(?:not|never)\s+(?:a\s+|fully\s+)?remote(?:ly)?\b|\bnot\s+eligible\s+for\s+remote\b|\bno\s+remote\b|\bremote\s+(?:work\s+)?(?:is\s+)?not\s+(?:available|offered|allowed|permitted|eligible)\b|\bcannot\s+(?:be|work|be\s+performed)\s+remote(?:ly)?\b/i;
const CLEARANCE_NEGATIVE =
	/\b(no\s+(?:security\s+)?clearance|clearance\s+not\s+required|does\s+not\s+require\s+(?:a\s+)?clearance)\b/i;

const PROFILE_OMIT_KEYS = new Set([
	"openaiapikey",
	"deepseekapikey",
	"gmailapppassword",
	"defaultpassword",
	"password",
	"maillabeldefinitions",
	"resumefolderurl",
]);

const PROFILE_OMIT_KEY_RE =
	/(apikey|api_key|apppassword|app_password|password|secret|token|privatekey|private_key)/i;

const PAGE_SYSTEM_PROMPT = `You analyze web pages for job applications. Use the applicant PROFILE JSON for answers. Respond with JSON only.

Return JSON with this exact shape:
{
  "isJobPage": boolean,
  "summary": string,
  "formAnswers": [{ "question": string, "suggestedAnswer": string, "confidence": "high"|"medium"|"low" }],
  "notJobPageReason": string | null
}

Rules:
- isJobPage true for a job posting OR an application form page.
- summary: 2-4 sentence JD summary when isJobPage is true.
- formAnswers: read the FULL page text and list EVERY application question / form prompt you can see (including follow-ups like "If Other…", "If yes, describe…", education, location, visa, LinkedIn, etc.). Answer each using the PROFILE JSON. Do not skip questions that appear only in the page text.
- Form fields list (if present) is only a hint — page text is the source of truth for what to answer.
- For dropdowns, prefer a value that matches listed options when options appear in the text or form hints.
- When a question maps clearly to a profile field, use that value with confidence "high".
- Never invent API keys or passwords. Never leave suggestedAnswer empty.
- notJobPageReason: required when isJobPage is false.`;

const RECOMMEND_RESUME_SYSTEM_PROMPT = `You recommend the best matching resume stack for a job description from a fixed list of Library resumes.

Respond with JSON only:
{
  "isJobDescription": boolean,
  "recommendedResume": string | null,
  "reason": string
}

Rules:
- isJobDescription true only when the page text clearly contains a job posting / job description (role requirements, responsibilities, qualifications). Application-only forms without a JD → false.
- When isJobDescription is false: recommendedResume must be null; reason briefly explains why.
- When isJobDescription is true: recommendedResume MUST be exactly one Resume label from the provided catalog list (copy the label character-for-character), or null if none fit.
- Prefer the stack whose skills best cover the JD requirements.
- Do not invent stack names. Do not include file extensions.
- reason: one short sentence.`;

function shouldOmitProfileKey(key) {
	const normalized = String(key || "").trim();
	if (!normalized) return true;
	if (PROFILE_OMIT_KEYS.has(normalized.toLowerCase())) return true;
	return PROFILE_OMIT_KEY_RE.test(normalized);
}

function sanitizeProfileForLlm(profile) {
	if (!profile || typeof profile !== "object") return {};
	const out = {};
	for (const [key, value] of Object.entries(profile)) {
		if (shouldOmitProfileKey(key)) continue;
		if (value === undefined || value === null || value === "") continue;
		out[key] = value;
	}
	return out;
}

function formatFormsText(pageContext) {
	return pageContext.forms?.length > 0
		? pageContext.forms
				.map((field, index) => {
					const parts = [
						`#${index + 1}`,
						field.label ? `label: ${field.label}` : null,
						field.name ? `name: ${field.name}` : null,
						field.type ? `type: ${field.type}` : null,
						field.placeholder ? `placeholder: ${field.placeholder}` : null,
						field.required ? "required: yes" : null,
						field.options?.length ? `options: ${field.options.join(", ")}` : null,
					].filter(Boolean);
					return parts.join(" | ");
				})
				.join("\n")
		: "(none — discover questions from page text)";
}

function buildPageUserPrompt(pageContext, profileJson, sessionContext) {
	const jdSummary = String(sessionContext?.jdSummary ?? "").trim();
	const jdText = String(sessionContext?.jdText ?? "").trim();
	const sessionBits = [];
	if (jdSummary) sessionBits.push(`Remembered JD summary: ${jdSummary}`);
	if (jdText) sessionBits.push(`Remembered JD text:\n${jdText}`);

	return `APPLICANT PROFILE (JSON — use for all answers; secrets already removed):
${profileJson}

${sessionBits.length ? `${sessionBits.join("\n\n")}\n\n` : ""}=== CURRENT PAGE ===
URL: ${pageContext.url}
Title: ${pageContext.title}
Meta: ${pageContext.metaDescription || "(none)"}

Page text (full innerText from page + iframes):
${String(pageContext.visibleText || "")}

Form field hints (optional; page text is authoritative):
${formatFormsText(pageContext)}`;
}

function normalizeFormAnswers(entries) {
	if (!Array.isArray(entries)) return [];
	return entries
		.map((entry) => ({
			question: String(entry?.question ?? "").trim(),
			suggestedAnswer: String(entry?.suggestedAnswer ?? "").trim(),
			confidence: ["high", "medium", "low"].includes(entry?.confidence)
				? entry.confidence
				: "medium",
		}))
		.filter((entry) => entry.question && entry.suggestedAnswer);
}

function extractFlagSentences(text, neededFlags) {
	const body = String(text ?? "").replace(/\s+/g, " ").trim();
	if (!body) return [];
	const patterns = neededFlags.map((flag) => FLAG_KEYWORDS[flag]).filter(Boolean);
	if (patterns.length === 0) return [];

	const sentences = body.split(/(?<=[.!?])\s+|\n+/);
	const seen = new Set();
	const matched = [];
	for (const raw of sentences) {
		const sentence = raw.trim();
		if (!sentence || sentence.length > 320) continue;
		if (!patterns.some((pattern) => pattern.test(sentence))) continue;
		const key = sentence.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		matched.push(sentence);
		if (matched.length >= 25) break;
	}
	return matched;
}

function buildFlagSystemPrompt(neededFlags) {
	const fields = neededFlags
		.map((flag) =>
			flag === "remote"
				? '  "remote": { "status": "green" | "red", "explanation": string }'
				: '  "clearance": { "status": "green" | "red", "explanation": string }',
		)
		.join(",\n");
	return `You screen a job description for hard constraints. Decide ONLY the requested fields. JSON only.

{
${fields}
}

Rules:
- Remote is intentionally permissive: return remote "green" when remote work is listed as any available location, arrangement, exception, or option, even if hybrid/onsite locations are also listed.
- Store/customer visits, travel, office-related business language, a headquarters location, or optional office access do not by themselves make a role non-remote.
- Return remote "red" only when the posting clearly requires every candidate to work onsite/hybrid, relocate, or regularly report to a physical location AND offers no remote path.
- If remote policy is missing, vague, conflicting, or merely uncertain, return remote "green". Resolve mixed remote + hybrid/onsite choices as "green".
- Clearance "red" means clearance is required for clearance-free applicants; otherwise clearance is "green".
- "green" = constraint satisfied.
- explanation: one short sentence.`;
}

function hasRemoteAllowance(text) {
	const body = String(text || "");
	if (!REMOTE_POSITIVE.test(body)) return false;
	const withoutDenials = body.replace(new RegExp(REMOTE_DENIAL.source, "gi"), " ");
	return REMOTE_POSITIVE.test(withoutDenials);
}

export function heuristicFlags(text, neededFlags) {
	const body = String(text || "");
	const result = {};
	const flags = Array.isArray(neededFlags) ? neededFlags : ["remote", "clearance"];

	if (flags.includes("remote")) {
		const matched = extractFlagSentences(body, ["remote"]);
		const hasPositive = hasRemoteAllowance(body);
		const hasExplicitDenial = REMOTE_DENIAL.test(body) && !hasPositive;
		const hasOnsite = FLAG_KEYWORDS.remote.test(body) && !hasPositive;
		if (hasExplicitDenial || hasOnsite) {
			result.remote = {
				status: "red",
				explanation:
					matched[0] || "The posting explicitly rules out remote work or requires onsite work.",
			};
		} else if (hasPositive) {
			result.remote = {
				status: "green",
				explanation: "Remote / WFH language found; no hard onsite requirement detected.",
			};
		} else {
			result.remote = {
				status: "green",
				explanation: "No clear onsite/hybrid/relocation requirement found in page text.",
			};
		}
	}

	if (flags.includes("clearance")) {
		const matched = extractFlagSentences(body, ["clearance"]);
		if (CLEARANCE_NEGATIVE.test(body)) {
			result.clearance = {
				status: "green",
				explanation: "Page states clearance is not required.",
			};
		} else if (FLAG_KEYWORDS.clearance.test(body) && matched.length) {
			result.clearance = {
				status: "red",
				explanation: matched[0] || "Security clearance / investigation language found.",
			};
		} else {
			result.clearance = {
				status: "green",
				explanation: "No clearance / fingerprint / polygraph requirement found.",
			};
		}
	}

	return result;
}

function normalizeVerdict(verdict) {
	if (!verdict || typeof verdict !== "object") return null;
	const status = verdict.status === "red" ? "red" : "green";
	return { status, explanation: String(verdict.explanation ?? "").trim() };
}

async function loadAccountCatalog(applierNameRaw) {
	const name = String(applierNameRaw ?? "").trim();
	if (!name || !accountInfoCollection) return { catalog: null, stackNames: [] };

	const proj = {
		projection: {
			resumeAnalysisCatalog: 1,
			resumeCatalog: 1,
			autoBidProfile: 1,
			name: 1,
		},
	};
	let acc = await accountInfoCollection.findOne({ name }, proj);
	if (!acc) {
		const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		acc = await accountInfoCollection.findOne(
			{ name: { $regex: new RegExp(`^${esc}$`, "i") } },
			proj,
		);
	}
	acc = await decryptAccountDoc(acc);
	const catalog =
		acc?.resumeAnalysisCatalog &&
		typeof acc.resumeAnalysisCatalog === "object" &&
		!Array.isArray(acc.resumeAnalysisCatalog)
			? acc.resumeAnalysisCatalog
			: acc?.resumeCatalog &&
				  typeof acc.resumeCatalog === "object" &&
				  !Array.isArray(acc.resumeCatalog)
				? acc.resumeCatalog
				: null;
	const { stackNames } = compressResumeCatalog(catalog || {});
	return { catalog, stackNames, autoBidProfile: acc?.autoBidProfile || null };
}

/**
 * @returns {{ result: object, usage: object|null, mode: 'llm'|'heuristic' }}
 */
export async function analyzeJobPage({ pageContext, applierName, sessionContext, jobId }) {
	if (!pageContext || typeof pageContext !== "object") {
		throw new Error("pageContext is required.");
	}

	const autoBidProfile = await loadDecryptedAutoBidProfile(applierName);
	const profile = autoBidProfile && typeof autoBidProfile === "object" ? autoBidProfile : {};
	const { provider, apiKey, model } = resolveDefaultModel(profile);
	const profileJson = JSON.stringify(sanitizeProfileForLlm(profile), null, 2);
	const jobIdStr = String(jobId ?? "").trim() || undefined;

	if (!apiKey) {
		return {
			result: {
				isJobPage: false,
				summary: "LLM unavailable — set an API key on the applier autoBidProfile.",
				formAnswers: [],
				formCount: 0,
				answeredCount: 0,
				pageUrl: pageContext.url,
				pageTitle: pageContext.title,
				applierName: applierName || null,
				notJobPageReason: "No LLM API key on profile.",
			},
			usage: null,
			mode: "heuristic",
		};
	}

	if (profileJson === "{}") {
		return {
			result: {
				isJobPage: false,
				summary: "No autoBidProfile found for this applier in MongoDB.",
				formAnswers: [],
				formCount: 0,
				answeredCount: 0,
				pageUrl: pageContext.url,
				pageTitle: pageContext.title,
				applierName: applierName || null,
				notJobPageReason: "Missing autoBidProfile.",
			},
			usage: null,
			mode: "heuristic",
		};
	}

	const { content, usage } = await chatCompletion({
		provider,
		apiKey,
		model,
		messages: [
			{ role: "system", content: PAGE_SYSTEM_PROMPT },
			{
				role: "user",
				content: buildPageUserPrompt(pageContext, profileJson, sessionContext),
			},
		],
		jsonMode: true,
		cacheKey: "athens-job-bid-page",
		feature: "bid-job-analyze",
		applierName,
		jobId: jobIdStr,
	});

	let parsed;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error("LLM returned invalid JSON for page analysis.");
	}

	const formAnswers = normalizeFormAnswers(parsed.formAnswers);

	return {
		result: {
			isJobPage: Boolean(parsed.isJobPage),
			summary: String(parsed.summary ?? "").trim(),
			formAnswers,
			notJobPageReason: parsed.notJobPageReason
				? String(parsed.notJobPageReason).trim()
				: undefined,
			pageUrl: pageContext.url,
			pageTitle: pageContext.title,
			applierName: applierName || null,
			formCount: formAnswers.length,
			answeredCount: formAnswers.length,
			charCount: String(pageContext.visibleText || "").length,
		},
		usage: summarizeUsage(usage, model),
		mode: "llm",
	};
}

/**
 * @returns {{ result: object, usage: object|null, mode: 'llm'|'heuristic' }}
 */
export async function analyzeJobFlags({
	pageContext,
	applierName,
	sessionContext,
	neededFlags = ["remote", "clearance"],
	jobId,
}) {
	if (!pageContext || typeof pageContext !== "object") {
		throw new Error("pageContext is required.");
	}

	const flags = (Array.isArray(neededFlags) ? neededFlags : ["remote", "clearance"]).filter(
		(f) => f === "remote" || f === "clearance",
	);
	if (flags.length === 0) {
		return { result: {}, usage: null, mode: "heuristic" };
	}

	const rememberedJd = String(sessionContext?.jdText ?? "").trim();
	const currentText = String(pageContext.visibleText ?? "").trim();
	const jdBody =
		rememberedJd && rememberedJd.length > currentText.length ? rememberedJd : currentText;
	const jobIdStr = String(jobId ?? "").trim() || undefined;

	const profile = (await loadDecryptedAutoBidProfile(applierName)) || {};
	const { provider, apiKey, model } = resolveDefaultModel(profile);

	if (!apiKey) {
		return { result: heuristicFlags(jdBody, flags), usage: null, mode: "heuristic" };
	}

	try {
		const matchedSentences = extractFlagSentences(jdBody, flags);
		const sentencesBlock = matchedSentences.length
			? matchedSentences.map((sentence) => `- ${sentence}`).join("\n")
			: "(no sentences matched the location/clearance keywords)";

		const { content, usage } = await chatCompletion({
			provider,
			apiKey,
			model,
			messages: [
				{ role: "system", content: buildFlagSystemPrompt(flags) },
				{
					role: "user",
					content: `KEYWORD-MATCHED SENTENCES:\n${sentencesBlock}\n\nJOB DESCRIPTION:\n${jdBody}`,
				},
			],
			jsonMode: true,
			cacheKey: "athens-job-bid-flags",
			feature: "bid-job-flags",
			applierName,
			jobId: jobIdStr,
		});

		let parsed;
		try {
			parsed = JSON.parse(content);
		} catch {
			throw new Error("LLM returned invalid JSON for flag analysis.");
		}

		const result = {};
		for (const flag of flags) {
			const verdict = normalizeVerdict(parsed[flag]);
			if (verdict) result[flag] = verdict;
		}
		// The remote screen is deliberately generous. Do not let an LLM choose a
		// hybrid city over an explicitly available remote location/arrangement.
		if (flags.includes("remote") && hasRemoteAllowance(jdBody)) {
			result.remote = {
				status: "green",
				explanation: "Remote work is explicitly listed as an available option.",
			};
		}
		if (!result.remote && !result.clearance) {
			return { result: heuristicFlags(jdBody, flags), usage: null, mode: "heuristic" };
		}
		return { result, usage: summarizeUsage(usage, model), mode: "llm" };
	} catch (err) {
		console.warn("[bid-job-analyze] flags LLM failed, using heuristic:", err.message);
		return { result: heuristicFlags(jdBody, flags), usage: null, mode: "heuristic" };
	}
}

/**
 * Recommend best Library resume stack from compressed resumeAnalysisCatalog + page JD text.
 * @returns {{ result: object, usage: object|null, mode: 'llm'|'heuristic' }}
 */
export async function recommendResumeForJob({ pageContext, applierName, jobId }) {
	if (!pageContext || typeof pageContext !== "object") {
		throw new Error("pageContext is required.");
	}

	const name = String(applierName ?? "").trim();
	if (!name) {
		throw new Error("applierName is required.");
	}

	const pageText = String(pageContext.visibleText ?? "").replace(/\s+/g, " ").trim();
	const jobIdStr = String(jobId ?? "").trim() || undefined;

	if (!pageText) {
		return {
			result: {
				isJobDescription: false,
				recommendedResume: null,
				matchedCatalogKey: null,
				useCustomizedResume: true,
				warning: "Page text is empty — open the job description page and try again.",
				reason: "No page text.",
				stackCount: 0,
			},
			usage: null,
			mode: "heuristic",
		};
	}

	const { catalog, stackNames, autoBidProfile } = await loadAccountCatalog(name);
	const { text: catalogText } = compressResumeCatalog(catalog || {});

	if (!stackNames.length) {
		return {
			result: {
				isJobDescription: true,
				recommendedResume: null,
				matchedCatalogKey: null,
				useCustomizedResume: true,
				warning: "No analyzed Library resumes in resumeAnalysisCatalog.",
				reason: "Empty catalog — use customized resume.",
				stackCount: 0,
			},
			usage: null,
			mode: "heuristic",
		};
	}

	const profile = autoBidProfile && typeof autoBidProfile === "object" ? autoBidProfile : {};
	const { provider, apiKey, model } = resolveDefaultModel(profile);

	if (!apiKey) {
		return {
			result: {
				isJobDescription: false,
				recommendedResume: null,
				matchedCatalogKey: null,
				useCustomizedResume: true,
				warning: "LLM unavailable — set an API key on the applier autoBidProfile.",
				reason: "No LLM API key.",
				stackCount: stackNames.length,
			},
			usage: null,
			mode: "heuristic",
		};
	}

	const allowedList = stackNames.map((s) => `- ${s}`).join("\n");
	const { content, usage } = await chatCompletion({
		provider,
		apiKey,
		model,
		messages: [
			{ role: "system", content: RECOMMEND_RESUME_SYSTEM_PROMPT },
			{
				role: "user",
				content: `ALLOWED RESUME LABELS (pick exactly one or null):\n${allowedList}\n\nRESUME CATALOG:\n${catalogText}\n\n=== PAGE TEXT ===\nURL: ${pageContext.url || "(unknown)"}\nTitle: ${pageContext.title || "(unknown)"}\n\n${pageText}`,
			},
		],
		jsonMode: true,
		cacheKey: "athens-job-recommend-resume",
		feature: "bid-recommend-resume",
		applierName: name,
		jobId: jobIdStr,
	});

	let parsed;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error("LLM returned invalid JSON for resume recommendation.");
	}

	const isJobDescription = Boolean(parsed.isJobDescription);
	const reason = String(parsed.reason ?? "").trim() || null;

	if (!isJobDescription) {
		return {
			result: {
				isJobDescription: false,
				recommendedResume: null,
				matchedCatalogKey: null,
				useCustomizedResume: false,
				warning:
					"This page does not appear to contain a job description. Open the JD page and try again.",
				reason: reason || "Not a job description.",
				stackCount: stackNames.length,
			},
			usage: summarizeUsage(usage, model),
			mode: "llm",
		};
	}

	const matchedCatalogKey = resolveCatalogKey(parsed.recommendedResume, stackNames);
	const useCustomizedResume = !matchedCatalogKey;

	return {
		result: {
			isJobDescription: true,
			recommendedResume: matchedCatalogKey,
			matchedCatalogKey,
			useCustomizedResume,
			warning: useCustomizedResume
				? "No Library stack matched — use customized resume."
				: null,
			reason: reason || (matchedCatalogKey ? `Matched ${matchedCatalogKey}.` : "No match."),
			stackCount: stackNames.length,
		},
		usage: summarizeUsage(usage, model),
		mode: "llm",
	};
}
