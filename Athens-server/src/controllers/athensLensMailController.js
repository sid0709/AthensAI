import { resolveMailCredentials } from "../services/mail/credentials.js";
import { fetchRecentInboxWithBodies } from "../services/mail/imapClient.js";
import { extractVerificationCode } from "../services/mail/verificationCode.js";

const DEFAULT_MESSAGE_LIMIT = 15;
const MAX_MESSAGE_LIMIT = 25;
const MAX_MESSAGE_TEXT_LENGTH = 200_000;

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
	};
}

export async function listAthensLensGmailMessages(req, res) {
	try {
		const applierName = req.athensLensSession.applierName;
		const credentials = await resolveMailCredentials(applierName);
		if (!credentials.ok) {
			return res.status(409).json({
				success: false,
				code: "GMAIL_NOT_CONFIGURED",
				message: credentials.error,
			});
		}

		const requestedLimit = Number.parseInt(String(req.query?.limit || DEFAULT_MESSAGE_LIMIT), 10);
		const limit = Math.max(1, Math.min(MAX_MESSAGE_LIMIT, requestedLimit || DEFAULT_MESSAGE_LIMIT));
		const liveMessages = await fetchRecentInboxWithBodies(
			credentials.email,
			credentials.password,
			limit,
		);
		const messages = liveMessages.map(mapAthensLensGmailMessage).filter((message) => message.id);

		return res.json({
			success: true,
			accountEmail: credentials.email,
			messages,
			total: messages.length,
			unreadCount: messages.filter((message) => message.isUnread).length,
		});
	} catch (error) {
		console.error("[athens-lens] Gmail inbox failed", error?.message || error);
		return res.status(502).json({
			success: false,
			code: "GMAIL_UNAVAILABLE",
			message: "Gmail could not be loaded. Check the profile email and Google app password.",
		});
	}
}

export const athensLensMailControllerTest = { isoDate, paragraphs };
