import bcrypt from "bcrypt";
import { accountInfoCollection } from "../db/dataStore.js";
import { listAthensLensJobs } from "../services/athensLensJobsService.js";
import { answerApplicationFormPage } from "../services/bidJobAnalyzeService.js";
import {
	createAthensLensSession,
	revokeAthensLensSession,
} from "../services/athensLensSessionService.js";
import { loadDecryptedAutoBidProfile } from "../services/autoBidProfileSecrets.js";
import { resolveDefaultModel } from "../services/llm/llmService.js";

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveLensAnalyzeModel(applierName) {
	const profile = (await loadDecryptedAutoBidProfile(applierName)) || {};
	const resolved = resolveDefaultModel(profile);
	if (resolved.error || !resolved.configured || !resolved.model) {
		throw Object.assign(
			new Error(resolved.error || "Set a default AI provider and model in Settings → Profile."),
			{ status: 400 },
		);
	}
	if (!resolved.apiKey) {
		const keyLabel = resolved.provider === "openai" ? "OpenAI" : "DeepSeek";
		throw Object.assign(
			new Error(`Add your ${keyLabel} API key in Settings → Profile to use Ask AI.`),
			{ status: 400 },
		);
	}
	return resolved;
}

async function findAccountByUsername(username) {
	if (!accountInfoCollection) return null;
	const projection = { name: 1, tier: 1, vendorAllowed: 1, vendorPassword: 1 };
	const exact = await accountInfoCollection.findOne({ name: username }, { projection });
	if (exact) return exact;
	return accountInfoCollection.findOne(
		{ name: { $regex: new RegExp(`^${escapeRegExp(username)}$`, "i") } },
		{ projection },
	);
}

export async function signInAthensLens(req, res) {
	try {
		const username = String(req.body?.username || "").trim();
		const password = String(req.body?.password || "");
		if (!username || !password) {
			return res.status(400).json({
				success: false,
				code: "MISSING_CREDENTIALS",
				message: "Username and vendor access password are required",
			});
		}
		if (username.length > 200) {
			return res.status(400).json({
				success: false,
				code: "INVALID_USERNAME",
				message: "Enter a valid username",
			});
		}

		const account = await findAccountByUsername(username);
		if (!account) {
			return res.status(401).json({
				success: false,
				code: "INVALID_CREDENTIALS",
				message: "Invalid username or vendor access password",
			});
		}

		if (!account.vendorAllowed) {
			return res.status(403).json({
				success: false,
				code: "VENDOR_ACCESS_OFF",
				message: "Vendor access is not enabled for this profile.",
			});
		}
		if (!account.vendorPassword) {
			return res.status(403).json({
				success: false,
				code: "VENDOR_PASSWORD_UNSET",
				message: "Set a vendor access password in Athens before signing in.",
			});
		}
		if (!(await bcrypt.compare(password, account.vendorPassword))) {
			return res.status(401).json({
				success: false,
				code: "INVALID_CREDENTIALS",
				message: "Invalid username or vendor access password",
			});
		}

		const result = await createAthensLensSession({
			accountId: account._id,
			applierName: account.name,
			username: account.name,
		});
		return res.json({
			success: true,
			session: {
				username: result.session.username,
				displayName: account.name,
				profileId: result.session.accountId,
				authenticatedAt: result.session.authenticatedAt,
				expiresAt: result.session.expiresAt,
				accessToken: result.token,
			},
		});
	} catch (error) {
		console.error("[athens-lens] sign-in failed", error?.message || error);
		return res.status(error?.status || 500).json({
			success: false,
			code: error?.code || "SIGN_IN_FAILED",
			message: error?.status === 503 ? error.message : "Unable to sign in",
		});
	}
}

export async function signOutAthensLens(req, res) {
	try {
		await revokeAthensLensSession(req.athensLensToken);
		return res.json({ success: true });
	} catch (error) {
		console.error("[athens-lens] sign-out failed", error?.message || error);
		return res.status(503).json({ success: false, message: "Unable to sign out" });
	}
}

export async function listAthensLensJobsHandler(req, res) {
	try {
		const jobs = await listAthensLensJobs(req.athensLensSession.applierName);
		return res.json({ success: true, jobs, total: jobs.length });
	} catch (error) {
		console.error("[athens-lens] jobs list failed", error?.message || error);
		return res.status(error?.status || 500).json({
			success: false,
			message: error?.status === 503 ? error.message : "Unable to load Bid Ready jobs",
		});
	}
}

export async function askAthensLensAi(req, res) {
	try {
		const pageContext = req.body?.pageContext;
		const visibleText = String(pageContext?.visibleText || "").trim();
		if (!pageContext || typeof pageContext !== "object" || !visibleText) {
			return res.status(400).json({
				success: false,
				code: "MISSING_PAGE_TEXT",
				message: "Open the application page and try Ask AI again.",
			});
		}

		await resolveLensAnalyzeModel(req.athensLensSession.applierName);

		const jobId = String(req.body?.jobId || "").trim() || null;
		const { result, mode, usage, requestId, provider, requestedModel, billedModel } =
			await answerApplicationFormPage({
				pageContext: {
					url: String(pageContext.url || ""),
					title: String(pageContext.title || ""),
					metaDescription: String(pageContext.metaDescription || ""),
					visibleText: visibleText.slice(0, 60_000),
					forms: Array.isArray(pageContext.forms) ? pageContext.forms.slice(0, 120) : [],
				},
				applierName: req.athensLensSession.applierName,
				jobTitle: req.body?.jobTitle || req.body?.sessionContext?.jdSummary || null,
				jobId,
			});

		if (jobId) {
			try {
				const { persistBidPageAnalysis } = await import("../services/bidAiArtifactPersist.js");
				await persistBidPageAnalysis({
					applierName: req.athensLensSession.applierName,
					jobId,
					result,
					usage,
					mode,
					call: { requestId, provider, requestedModel, billedModel },
				});
			} catch (persistError) {
				console.warn("[athens-lens] ask-ai persist skipped", persistError?.message || persistError);
			}
		}

		return res.json({
			success: true,
			mode,
			summary: result.summary || "",
			answers: Array.isArray(result.formAnswers) ? result.formAnswers : [],
			pageUrl: result.pageUrl || pageContext.url || "",
			pageTitle: result.pageTitle || pageContext.title || "",
		});
	} catch (error) {
		console.error("[athens-lens] ask-ai failed", error?.message || error);
		const message = String(error?.message || "Unable to analyze the open page");
		const status = error?.status
			|| (/API key|default AI|Settings → Profile|profile data/i.test(message) ? 400 : 500);
		return res.status(status).json({
			success: false,
			message,
		});
	}
}

export const athensLensControllerTest = { findAccountByUsername };
