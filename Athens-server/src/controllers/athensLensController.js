import bcrypt from "bcrypt";
import { accountInfoCollection } from "../db/dataStore.js";
import { listAthensLensJobs } from "../services/athensLensJobsService.js";
import {
	answerApplicationFormPage,
	streamApplicationFormPage,
} from "../services/bidJobAnalyzeService.js";
import {
	createAthensLensSession,
	revokeAthensLensSession,
} from "../services/athensLensSessionService.js";

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
	const pageContext = req.body?.pageContext;
	const visibleText = String(pageContext?.visibleText || "").trim();
	const formTree = String(pageContext?.formTree || "").trim();
	if (!pageContext || typeof pageContext !== "object" || (!visibleText && !formTree)) {
		return res.status(400).json({
			success: false,
			code: "MISSING_PAGE_TEXT",
			message: "Open the application page and try Ask AI again.",
		});
	}

	const wantStream = req.body?.stream !== false
		&& (req.body?.stream === true || String(req.headers.accept || "").includes("text/event-stream"));

	const normalizedContext = {
		url: String(pageContext.url || ""),
		title: String(pageContext.title || ""),
		metaDescription: String(pageContext.metaDescription || ""),
		visibleText: visibleText.slice(0, 12_000),
		formTree: formTree.slice(0, 12_000),
		forms: Array.isArray(pageContext.forms) ? pageContext.forms.slice(0, 120) : [],
	};
	const jobId = String(req.body?.jobId || "").trim() || null;
	const jobTitle = req.body?.jobTitle || req.body?.sessionContext?.jdSummary || null;
	const applierName = req.athensLensSession.applierName;

	if (wantStream) {
		res.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		const send = (event, data) => {
			if (res.destroyed || res.writableEnded) return;
			res.write(`event: ${event}\n`);
			res.write(`data: ${JSON.stringify(data)}\n\n`);
		};
		let closed = false;
		req.once("close", () => { closed = true; });
		const abort = new AbortController();
		req.once("close", () => abort.abort());

		try {
			let finalPayload = null;
			for await (const event of streamApplicationFormPage({
				pageContext: normalizedContext,
				applierName,
				jobTitle,
				jobId,
				signal: abort.signal,
			})) {
				if (closed) break;
				if (event.type === "delta") {
					send("token", { text: event.text || "" });
					continue;
				}
				if (event.type === "answers") {
					send("answers", { answers: event.answers || [] });
					continue;
				}
				if (event.type === "done") {
					finalPayload = event;
					send("done", {
						success: true,
						mode: event.mode || "llm-stream",
						summary: event.summary || "",
						answers: event.answers || [],
						pageUrl: normalizedContext.url,
						pageTitle: normalizedContext.title,
					});
				}
			}

			if (jobId && finalPayload) {
				try {
					const { persistBidPageAnalysis } = await import("../services/bidAiArtifactPersist.js");
					await persistBidPageAnalysis({
						applierName,
						jobId,
						result: {
							summary: finalPayload.summary || "",
							formAnswers: finalPayload.answers || [],
							formCount: (finalPayload.answers || []).length,
							answeredCount: (finalPayload.answers || []).length,
							pageUrl: normalizedContext.url,
							pageTitle: normalizedContext.title,
							applierName,
						},
						usage: finalPayload.usage,
						mode: finalPayload.mode || "llm-stream",
						call: {
							requestId: finalPayload.requestId,
							provider: finalPayload.provider,
							requestedModel: finalPayload.requestedModel,
							billedModel: finalPayload.billedModel,
						},
					});
				} catch (persistError) {
					console.warn("[athens-lens] ask-ai stream persist skipped", persistError?.message || persistError);
				}
			}
		} catch (error) {
			console.error("[athens-lens] ask-ai stream failed", error?.message || error);
			if (!closed) {
				send("error", {
					message: String(error?.message || "Unable to analyze the open page"),
					status: error?.status || 500,
				});
			}
		} finally {
			if (!res.destroyed && !res.writableEnded) res.end();
		}
		return;
	}

	try {
		const { result, mode, usage, requestId, provider, requestedModel, billedModel } =
			await answerApplicationFormPage({
				pageContext: normalizedContext,
				applierName,
				jobTitle,
				jobId,
			});

		if (jobId) {
			try {
				const { persistBidPageAnalysis } = await import("../services/bidAiArtifactPersist.js");
				await persistBidPageAnalysis({
					applierName,
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
