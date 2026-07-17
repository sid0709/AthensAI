/**
 * AI assist for composing / fine-tuning / replying to emails.
 */
import { chatCompletion, resolveDefaultModel } from '../llm/llmService.js';

const WRITE_SYSTEM_PROMPT = [
	'You write professional email drafts from a short user prompt.',
	'Return ONLY the email body text (plain text). Do not include a subject line, markdown fences, or commentary.',
	'Keep the tone clear and professional unless the user asks otherwise.',
	'Do not invent facts the user did not provide.',
].join('\n');

const REPLY_SYSTEM_PROMPT = [
	'You write a short reply to an email the user received.',
	'Use the original message for context. Match a natural, professional tone.',
	'Address the sender appropriately when their name is clear.',
	'Keep the reply concise (usually 2–6 sentences) unless the user asks for more.',
	'Do not invent commitments, dates, or facts not implied by the user intent or original message.',
	'Do not include a subject line, greeting boilerplate like "Dear Sir/Madam" unless fitting, markdown fences, or commentary.',
	'Return ONLY the reply body as plain text.',
].join('\n');

const FINE_TUNE_SYSTEM_PROMPT = [
	'You are an email proofreader. Your ONLY job is light grammar and clarity cleanup.',
	'Fix grammar, spelling, punctuation, and awkward phrasing.',
	'Do NOT change meaning, tone intent, facts, names, dates, numbers, or overall structure.',
	'Do NOT add new content, remove substantive content, or make the email more salesy or formal unless required for grammar.',
	'Do NOT rewrite into a different style. Prefer the smallest edit that fixes the issue.',
	'Return ONLY the revised email body as plain text. No subject, no markdown fences, no commentary.',
].join('\n');

const BODY_MAX = 20000;
const PROMPT_MAX = 4000;

function pickProvider(profile) {
	const resolved = resolveDefaultModel(profile);
	return resolved.apiKey ? resolved : null;
}

function stripFences(text) {
	return String(text ?? '')
		.replace(/^```(?:\w+)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
}

function resolveMode(raw) {
	if (raw === 'fine-tune') return 'fine-tune';
	if (raw === 'reply') return 'reply';
	return 'write';
}

/**
 * @param {{ mode: 'write'|'fine-tune'|'reply', prompt?: string, body?: string, subject?: string, replyContext?: string }} input
 * @param {object} profile decrypted autoBidProfile
 * @param {{ applierName?: string }} [context]
 */
export async function runMailAiWrite(input, profile, context = {}) {
	const picked = pickProvider(profile);
	if (!picked) {
		return { ok: false, error: 'No LLM API key on applier profile' };
	}

	const mode = resolveMode(input.mode);
	const prompt = String(input.prompt || '').trim().slice(0, PROMPT_MAX);
	const body = String(input.body || '').trim().slice(0, BODY_MAX);
	const subject = String(input.subject || '').trim().slice(0, 500);
	const replyContext = String(input.replyContext || '').trim().slice(0, BODY_MAX);

	if (mode === 'write' && !prompt && !replyContext) {
		return { ok: false, error: 'prompt is required for write mode' };
	}
	if (mode === 'reply' && !replyContext && !prompt) {
		return { ok: false, error: 'replyContext or prompt is required for reply mode' };
	}
	if (mode === 'fine-tune' && !body) {
		return { ok: false, error: 'body is required for fine-tune mode' };
	}

	const system =
		mode === 'fine-tune'
			? FINE_TUNE_SYSTEM_PROMPT
			: mode === 'reply'
				? REPLY_SYSTEM_PROMPT
				: WRITE_SYSTEM_PROMPT;

	const parts = [];

	if (subject) parts.push(`Subject: ${subject}`);
	if (replyContext) {
		parts.push(mode === 'reply' ? 'Email you are replying to:' : 'Original message being replied to:');
		parts.push('```');
		parts.push(replyContext);
		parts.push('```');
	}

	if (mode === 'fine-tune') {
		parts.push('Fine-tune (grammar only) this email body:');
		parts.push('```');
		parts.push(body);
		parts.push('```');
		if (prompt) {
			parts.push('Additional instruction (still preserve meaning):');
			parts.push(prompt);
		}
	} else if (mode === 'reply') {
		parts.push('User intent for the reply:');
		parts.push(prompt || 'Write a polite, concise professional reply.');
	} else {
		parts.push('Write an email body for this request:');
		parts.push(prompt || 'Write a polite, concise reply based on the original message.');
	}

	try {
		const { content, usage } = await chatCompletion({
			provider: picked.provider,
			apiKey: picked.apiKey,
			model: picked.model,
			feature: 'mail-ai-write',
			applierName: context.applierName,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: parts.join('\n') },
			],
			timeoutMs: 60000,
		});

		const text = stripFences(content);
		if (!text) {
			return { ok: false, error: 'AI returned empty draft', usage };
		}
		return { ok: true, body: text, usage };
	} catch (err) {
		return { ok: false, error: err?.message || String(err) };
	}
}
