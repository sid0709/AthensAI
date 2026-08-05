import { resolveMailCredentials } from "../services/mail/credentials.js";
import {
	fetchInboxBodiesByUid,
	fetchLabelMailboxEnvelopes,
} from "../services/mail/imapClient.js";
import { extractVerificationCode } from "../services/mail/verificationCode.js";

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 40;
const MAX_BODY_BATCH_SIZE = 8;
const MAX_MESSAGE_TEXT_LENGTH = 100_000;
/** Gmail label mailbox used by Athens Lens (IMAP folder path). */
const ATHENS_LENS_GMAIL_LABEL = "Notify/Unnecessary";

function text(value) {
	return typeof value === "string" ? value.trim() : "";
}

function paragraphs(value) {
	const normalized = text(value).replace(/\r\n?/g, "\n");
	if (!normalized) return [];
	const blocks = normalized.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
	return blocks.length ? blocks : [normalized];
}

function isoDate(value) {
	const date = value instanceof Date ? value : new Date(value || "");
	return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

export function mapAthensLensGmailMessage(message) {
	const bodyText = text(message?.bodyText).slice(0, MAX_MESSAGE_TEXT_LENGTH);
	const subject = text(message?.subject) || "(No subject)";
	const securityCode = extractVerificationCode(`${subject}\n${bodyText}`);
	const previewSource = bodyText.replace(/\s+/g, " ") || subject;
	const senderEmail = text(message?.from);

	return {
		id: String(message?.uid || ""),
		sender: text(message?.fromName) || senderEmail || "Unknown sender",
		senderEmail,
		subject,
		preview: previewSource.slice(0, 160),
		receivedAt: isoDate(message?.date),
		isUnread: message?.seen !== true,
		kind: securityCode ? "security-code" : "general",
		...(securityCode ? { securityCode } : {}),
		body: paragraphs(bodyText),
		bodyLoaded: true,
	};
}

export function mapAthensLensGmailEnvelope(message) {
	const subject = text(message?.subject) || "(No subject)";
	const securityCode = extractVerificationCode(subject);
	const senderEmail = text(message?.from);
	return {
		id: String(message?.uid || ""),
		sender: text(message?.fromName) || senderEmail || "Unknown sender",
		senderEmail,
		subject,
		preview: "",
		receivedAt: isoDate(message?.date),
		isUnread: message?.seen !== true,
		kind: securityCode ? "security-code" : "general",
		...(securityCode ? { securityCode } : {}),
		body: [],
		bodyLoaded: false,
	};
}

async function mailCredentials(req, res) {
	const credentials = await resolveMailCredentials(req.athensLensSession.applierName);
	if (credentials.ok) return credentials;
	res.status(409).json({
		success: false,
		code: "GMAIL_NOT_CONFIGURED",
		message: credentials.error,
	});
	return null;
}

export async function listAthensLensGmailMessages(req, res) {
	try {
		const credentials = await mailCredentials(req, res);
		if (!credentials) return;

		const page = Math.max(1, Number.parseInt(String(req.query?.page || "1"), 10) || 1);
		const requestedSize = Number.parseInt(String(req.query?.pageSize || DEFAULT_PAGE_SIZE), 10);
		const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, requestedSize || DEFAULT_PAGE_SIZE));
		const label = text(req.query?.label) || ATHENS_LENS_GMAIL_LABEL;

		const live = await fetchLabelMailboxEnvelopes(
			credentials.email,
			credentials.password,
			label,
			{ page, pageSize },
		);
		const messages = (live.messages || []).map(mapAthensLensGmailEnvelope).filter((message) => message.id);

		return res.json({
			success: true,
			accountEmail: credentials.email,
			label,
			page,
			pageSize,
			hasMore: Boolean(live.hasMore),
			messages,
			total: Number(live.total) || messages.length,
			unreadCount: messages.filter((message) => message.isUnread).length,
		});
	} catch (error) {
		console.error("[athens-lens] Gmail inbox failed", error?.message || error);
		return res.status(502).json({
			success: false,
			code: "GMAIL_UNAVAILABLE",
			message: "Gmail could not be loaded. Check the profile email, Google app password, and Notify/Unnecessary label.",
		});
	}
}

export async function listAthensLensGmailMessageBodies(req, res) {
	try {
		const requestedIds = String(req.query?.ids || "")
			.split(",")
			.map((value) => value.trim())
			.filter((value) => /^\d+$/.test(value))
			.map((value) => Number.parseInt(value, 10))
			.filter((value) => Number.isSafeInteger(value) && value > 0);
		const ids = [...new Set(requestedIds)].slice(0, MAX_BODY_BATCH_SIZE);
		if (!ids.length) {
			return res.status(400).json({
				success: false,
				code: "INVALID_MESSAGE_IDS",
				message: "At least one valid Gmail message ID is required.",
			});
		}

		const credentials = await mailCredentials(req, res);
		if (!credentials) return;
		const label = text(req.query?.label) || ATHENS_LENS_GMAIL_LABEL;
		const liveMessages = await fetchInboxBodiesByUid(
			credentials.email,
			credentials.password,
			ids,
			{ mailboxPath: label },
		);
		const messages = liveMessages.map(mapAthensLensGmailMessage).filter((message) => message.id);
		return res.json({ success: true, messages });
	} catch (error) {
		console.error("[athens-lens] Gmail message bodies failed", error?.message || error);
		return res.status(502).json({
			success: false,
			code: "GMAIL_UNAVAILABLE",
			message: "Gmail message content could not be loaded.",
		});
	}
}

export const athensLensMailControllerTest = { isoDate, paragraphs, ATHENS_LENS_GMAIL_LABEL };
