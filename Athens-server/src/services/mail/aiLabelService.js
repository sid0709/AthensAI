/**
 * AI classification of inbox emails into a single custom Gmail label.
 */
import { chatCompletion, resolveDefaultModel } from '../llm/llmService.js';
import { getMailAiLabelConcurrency, mapPool } from '../../utils/concurrency.js';
import { addLabelsToMessage, fetchFlagsForUids } from './imapClient.js';
import { ensureMessagePlainText } from './mailSyncService.js';
import { getMessage, updateMessageFlags } from './mailStore.js';
import { folderToMailbox } from './folderMapper.js';

const BODY_MAX_CHARS = 6000;

const CLASSIFY_SYSTEM_PROMPT = [
	'You classify emails into exactly ONE custom Gmail label from a provided list.',
	'Read the sender, subject, and plain-text body. Pick the single best-matching label.',
	'If no label is a reasonable fit, return null for label.',
	'Return ONLY JSON: { "label": string|null }.',
	'The label value MUST be copied exactly from the allowed list (case-sensitive).',
].join('\n');

function parseJsonLoose(text) {
	const raw = String(text ?? '').trim();
	try {
		return JSON.parse(raw);
	} catch {
		/* fall through */
	}
	const fenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
	const first = fenced.indexOf('{');
	const last = fenced.lastIndexOf('}');
	if (first !== -1 && last > first) {
		try {
			return JSON.parse(fenced.slice(first, last + 1));
		} catch {
			/* fall through */
		}
	}
	return null;
}

function pickProvider(profile) {
	const resolved = resolveDefaultModel(profile);
	return resolved.apiKey ? resolved : null;
}

function buildLabelCatalog(allowedLabels, labelDefinitions = {}) {
	return allowedLabels.map((name) => {
		const desc = String(labelDefinitions[name] || '').trim();
		return desc ? `- ${name}: ${desc}` : `- ${name}`;
	});
}

function resolveCanonicalLabel(raw, allowedLabels) {
	const candidate = String(raw ?? '').trim();
	if (!candidate) return null;
	const exact = allowedLabels.find((l) => l === candidate);
	if (exact) return exact;
	const lower = candidate.toLowerCase();
	const ci = allowedLabels.find((l) => l.toLowerCase() === lower);
	return ci || null;
}

/**
 * @param {{ from?: string, subject?: string, bodyText?: string }} message
 * @param {string[]} allowedLabels
 * @param {Record<string, string>} labelDefinitions
 * @param {object} profile decrypted autoBidProfile
 * @param {{ applierName?: string }} [context]
 */
export async function classifyMailLabel(message, allowedLabels, labelDefinitions, profile, context = {}) {
	const picked = pickProvider(profile);
	if (!picked) {
		return { label: null, error: 'No LLM API key on applier profile' };
	}
	if (!allowedLabels.length) {
		return { label: null, error: 'No custom Gmail labels available' };
	}

	const catalog = buildLabelCatalog(allowedLabels, labelDefinitions);
	const from = String(message.from || '').slice(0, 200);
	const subject = String(message.subject || '').slice(0, 300);
	const body = String(message.bodyText || '').replace(/\u00A0/g, ' ').slice(0, BODY_MAX_CHARS);

	const userContent = [
		'Allowed labels (pick exactly one name, or null if none fit):',
		...catalog,
		'',
		`From: ${from}`,
		`Subject: ${subject}`,
		'',
		'Email body (plain text):',
		'```',
		body || '(empty)',
		'```',
		'Return the JSON.',
	].join('\n');

	try {
		const { content, usage } = await chatCompletion({
			provider: picked.provider,
			apiKey: picked.apiKey,
			model: picked.model,
			feature: 'mail-ai-label',
			jsonMode: true,
			applierName: context.applierName,
			messages: [
				{ role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
				{ role: 'user', content: userContent },
			],
			timeoutMs: 60000,
		});

		const parsed = parseJsonLoose(content) || {};
		const rawLabel = parsed.label === null ? null : parsed.label;
		const label = rawLabel ? resolveCanonicalLabel(rawLabel, allowedLabels) : null;

		if (rawLabel && !label) {
			return { label: null, usage, error: `AI returned invalid label: "${rawLabel}"` };
		}

		return { label, usage };
	} catch (err) {
		return { label: null, error: err?.message || String(err) };
	}
}

function mergeUsage(a, b) {
	if (!a && !b) return undefined;
	const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
	const out = {};
	for (const k of keys) {
		const av = a?.[k];
		const bv = b?.[k];
		if (typeof av === 'number' || typeof bv === 'number') {
			out[k] = (typeof av === 'number' ? av : 0) + (typeof bv === 'number' ? bv : 0);
		} else {
			out[k] = av ?? bv;
		}
	}
	return out;
}

/**
 * Classify + apply a label for a single message.
 * @returns {Promise<{ result: object, usage?: object }>}
 */
async function processOneMessage({
	item,
	applierName,
	profile,
	email,
	password,
	allowedLabels,
	labelDefinitions,
}) {
	const uid = Number(item.uid);
	if (!Number.isFinite(uid)) {
		return { result: { uid: item.uid, label: null, applied: false, error: 'Invalid uid' } };
	}

	const inboxMailbox = folderToMailbox('inbox');
	const hintMailbox = typeof item.mailbox === 'string' && item.mailbox.trim() ? item.mailbox.trim() : null;
	let doc = null;
	if (hintMailbox) doc = await getMessage(applierName, uid, hintMailbox);
	if (!doc) doc = await getMessage(applierName, uid, inboxMailbox);
	if (!doc) doc = await getMessage(applierName, uid);
	if (!doc) {
		return { result: { uid, label: null, applied: false, error: 'Message not found' } };
	}

	const textResult = await ensureMessagePlainText(
		applierName,
		uid,
		doc.mailbox || hintMailbox || inboxMailbox,
	);
	if (!textResult.ok) {
		return {
			result: { uid, label: null, applied: false, error: textResult.error || 'Failed to load body text' },
		};
	}
	doc = textResult.message || doc;

	const fromDisplay = doc.from?.name
		? doc.from.email
			? `${doc.from.name} <${doc.from.email}>`
			: doc.from.name
		: doc.from?.email || '';

	const { label, usage, error } = await classifyMailLabel(
		{
			from: fromDisplay,
			subject: doc.subject || '',
			bodyText: textResult.bodyText || doc.bodyText || '',
		},
		allowedLabels,
		labelDefinitions,
		profile,
		{ applierName },
	);

	if (!label) {
		return {
			result: { uid, label: null, applied: false, error: error || 'No matching label' },
			usage,
		};
	}

	try {
		const msgMailbox = doc.mailbox || inboxMailbox;
		await addLabelsToMessage(email, password, uid, [label], msgMailbox);
		const refreshed = await fetchFlagsForUids(email, password, [uid], applierName, msgMailbox);
		if (refreshed[0]) {
			await updateMessageFlags(applierName, uid, {
				gmailLabels: refreshed[0].gmailLabels,
				labels: refreshed[0].labels,
				folder: refreshed[0].folder,
				flags: refreshed[0].flags,
			}, msgMailbox);
		}
		return { result: { uid, label, applied: true }, usage };
	} catch (err) {
		return {
			result: {
				uid,
				label,
				applied: false,
				error: err?.message || String(err),
			},
			usage,
		};
	}
}

/**
 * Batch classify and apply labels to selected messages (bounded parallel).
 * @param {object} opts
 * @param {string} opts.applierName
 * @param {object} opts.profile decrypted autoBidProfile
 * @param {string} opts.email Gmail address
 * @param {string} opts.password Gmail app password
 * @param {Array<{ uid: number, mailbox?: string }>} opts.messages
 * @param {string[]} opts.allowedLabels
 * @param {Record<string, string>} opts.labelDefinitions
 */
export async function runMailAiLabelBatch({
	applierName,
	profile,
	email,
	password,
	messages,
	allowedLabels,
	labelDefinitions = {},
}) {
	const picked = pickProvider(profile);
	if (!picked) {
		return { ok: false, error: 'No LLM API key on applier profile. Configure one in Settings → Profile.' };
	}

	const list = Array.isArray(messages) ? messages : [];
	const concurrency = getMailAiLabelConcurrency();
	const settled = await mapPool(list, concurrency, (item) =>
		processOneMessage({
			item,
			applierName,
			profile,
			email,
			password,
			allowedLabels,
			labelDefinitions,
		}),
	);

	let totalUsage;
	const results = [];
	for (const entry of settled) {
		if (entry?.usage) totalUsage = mergeUsage(totalUsage, entry.usage);
		if (entry?.result) results.push(entry.result);
	}

	return { ok: true, results, usage: totalUsage };
}
