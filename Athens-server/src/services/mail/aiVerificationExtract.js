/**
 * AI extraction of a verification code OR verification link from recent emails.
 *
 * Two AI passes, no regex / vendor rules / hardcoding anywhere:
 *   1. SELECT — the model reads ONLY the sender + subject line of the newest
 *      emails and decides which one is the one-time verification / security code
 *      email needed to finish submitting the form right now. Prefers the NEWEST
 *      candidate (codes are often re-sent, so two "security code" emails can
 *      arrive — we want the latest).
 *   2. EXTRACT — the model reads the CONTENT of just the selected email and pulls
 *      out the exact code (or click-to-verify link).
 *
 * Company / job title are passed only as SOFT hints — a generic verification
 * email (e.g. from the ATS) never mentions the company, so we must not require it.
 */
import { chatCompletion, resolveDefaultModel } from "../llm/llmService.js";

const SELECT_SYSTEM_PROMPT = [
  "You are picking which ONE recent inbox email carries the one-time verification /",
  "security code (or a click-to-verify link) needed to finish submitting a web form",
  "right now (e.g. a job application asking to 'enter the code we emailed you').",
  "",
  "Decide using ONLY the sender and the subject line. Do NOT assume message body content.",
  "These emails are usually generic ('Your security code', 'Verify your email',",
  "'Confirm you're human', 'One-time passcode') and DO NOT mention the company or role —",
  "so never require the company/job name to appear. Any company/job hints are SOFT: use",
  "them only to break ties, never to reject an otherwise-valid verification email.",
  "",
  "Emails are ordered NEWEST-FIRST (index 0 = most recent). If several look like",
  "verification/security-code emails, pick the NEWEST one (the lowest index) — codes are",
  "frequently re-sent and only the latest is valid.",
  "Ignore clearly unrelated codes (bank logins, shopping receipts, password resets for",
  "unrelated services) ONLY when a better job/form verification email exists.",
  "",
  'Return ONLY JSON: { "found": boolean, "emailIndex": number|null }.',
].join("\n");

const EXTRACT_SYSTEM_PROMPT = [
  "You are reading ONE email and extracting the one-time verification / security code",
  "the user must type to finish submitting a form, OR a click-to-verify link if the email",
  "uses a link instead of a code.",
  "",
  'Return ONLY JSON: { "code": string|null, "link": string|null }.',
  "- code: the EXACT characters to type — preserve case, strip surrounding spaces, and if",
  "  the code is shown spaced/boxed (e.g. '1 2 3 4 5 6 7 8') join it into one token.",
  "- link: a full https URL only if the email is click-to-verify instead of a code.",
  "If the email has neither a code nor a verify link, return both null.",
].join("\n");

function parseJsonLoose(text) {
  const raw = String(text ?? "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const first = fenced.indexOf("{");
  const last = fenced.lastIndexOf("}");
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

/** Sum two loose usage objects (best-effort; missing fields treated as 0). */
function mergeUsage(a, b) {
  if (!a && !b) return undefined;
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out = {};
  for (const k of keys) {
    const av = a?.[k];
    const bv = b?.[k];
    if (typeof av === "number" || typeof bv === "number") {
      out[k] = (typeof av === "number" ? av : 0) + (typeof bv === "number" ? bv : 0);
    } else {
      out[k] = av ?? bv;
    }
  }
  return out;
}

/**
 * @param {Array<{from?:string, subject?:string, snippet?:string, body?:string, date?:any}>} emails newest-first
 * @param {object} profile applier autoBidProfile (LLM key)
 * @param {{ companyName?: string, jobTitle?: string }} [context]
 * @returns {Promise<{found:boolean, code:string|null, link:string|null, emailIndex:number|null, usage?:any}>}
 */
export async function aiExtractVerification(emails, profile, context = {}) {
  const picked = pickProvider(profile);
  if (!picked) {
    console.warn("[otp-extract] no LLM API key on applier autoBidProfile — cannot read Gmail for OTP");
    return { found: false, code: null, link: null, emailIndex: null, note: "no LLM API key on applier profile" };
  }
  if (!Array.isArray(emails) || emails.length === 0) {
    return { found: false, code: null, link: null, emailIndex: null, note: "no emails to scan" };
  }

	const companyName = String(context.companyName || "").trim();
	const jobTitle = String(context.jobTitle || "").trim();
	const applierName = String(context.applierName || "").trim() || undefined;

  // Caller already passes emails newest-first; keep that order so `emailIndex`
  // maps straight back to the caller's array (no internal re-sort / index drift).
  const ordered = emails.slice(0, 10);

  // ── STEP 1 — select by sender + subject only (NO body) ───────────────────────
  const selectPayload = ordered.map((e, i) => ({
    index: i,
    date: e.date ? new Date(e.date).toISOString() : null,
    from: String(e.from || "").slice(0, 160),
    subject: String(e.subject || "").slice(0, 240),
  }));

  const selectHints = [];
  if (companyName) selectHints.push(`Soft hint — company applied to: "${companyName}" (do NOT require it to appear).`);
  if (jobTitle) selectHints.push(`Soft hint — job title: "${jobTitle}".`);

  const selectUser = [
    "We just clicked Submit on a form and the page is asking for the emailed verification/security code.",
    "Pick which email below is that verification email, using sender + subject ONLY.",
    ...selectHints,
    "",
    `Last ${selectPayload.length} emails, newest first (index 0 = most recent):`,
    "```json",
    JSON.stringify(selectPayload, null, 2),
    "```",
    "Return the JSON.",
  ].join("\n");

  let selectUsage;
  let selectedIndex = null;
  try {
    const { content, usage } = await chatCompletion({
      provider: picked.provider,
      apiKey: picked.apiKey,
      model: picked.model,
      feature: "mail-otp-select",
      jsonMode: true,
			applierName,
      messages: [
        { role: "system", content: SELECT_SYSTEM_PROMPT },
        { role: "user", content: selectUser },
      ],
      timeoutMs: 45000,
    });
    selectUsage = usage;
    const parsed = parseJsonLoose(content) || {};
    if (parsed.found && Number.isInteger(parsed.emailIndex) && parsed.emailIndex >= 0 && parsed.emailIndex < ordered.length) {
      selectedIndex = parsed.emailIndex;
    }
    console.log(
      `[otp-extract] select over ${selectPayload.length} subject(s): ` +
        selectPayload.map((p) => `#${p.index} "${p.subject}"`).join(" | "),
    );
    console.log(`[otp-extract] AI selected index: ${selectedIndex}`);
  } catch (err) {
    console.warn("[otp-extract] select pass failed:", err?.message || err);
    return { found: false, code: null, link: null, emailIndex: null, usage: selectUsage, note: `select AI error: ${err?.message || err}` };
  }

  if (selectedIndex == null) {
    return {
      found: false,
      code: null,
      link: null,
      emailIndex: null,
      usage: selectUsage,
      note: "AI found no verification email among the scanned subjects",
    };
  }

  // ── STEP 2 — extract the code from the selected email's CONTENT ───────────────
  const chosen = ordered[selectedIndex];
  const extractUser = [
    `From: ${String(chosen.from || "").slice(0, 200)}`,
    `Subject: ${String(chosen.subject || "").slice(0, 300)}`,
    chosen.date ? `Date: ${new Date(chosen.date).toISOString()}` : "",
    "",
    "Email content:",
    "```",
    String(chosen.body || chosen.snippet || "").replace(/\u00A0/g, " ").slice(0, 6000),
    "```",
    "Return the JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  let extractUsage;
  try {
    const { content, usage } = await chatCompletion({
      provider: picked.provider,
      apiKey: picked.apiKey,
      model: picked.model,
      feature: "mail-otp-extract",
      jsonMode: true,
			applierName,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM_PROMPT },
        { role: "user", content: extractUser },
      ],
      timeoutMs: 45000,
    });
    extractUsage = usage;
    const parsed = parseJsonLoose(content) || {};
    const code = typeof parsed.code === "string" && parsed.code.trim() ? parsed.code.trim() : null;
    const link =
      typeof parsed.link === "string" && /^https?:\/\//i.test(parsed.link.trim()) ? parsed.link.trim() : null;
    console.log(
      `[otp-extract] extracted from #${selectedIndex} "${String(chosen.subject || "").slice(0, 80)}": ` +
        `${code ? `code=${code}` : link ? "link" : "nothing"}`,
    );
    return {
      found: Boolean(code || link),
      code,
      link,
      emailIndex: selectedIndex,
      usage: mergeUsage(selectUsage, extractUsage),
      note: code || link
        ? `extracted from #${selectedIndex} "${String(chosen.subject || "").slice(0, 60)}"`
        : `selected #${selectedIndex} "${String(chosen.subject || "").slice(0, 60)}" but no code/link in its content`,
    };
  } catch (err) {
    console.warn("[otp-extract] extract pass failed:", err?.message || err);
    return {
      found: false,
      code: null,
      link: null,
      emailIndex: selectedIndex,
      usage: mergeUsage(selectUsage, extractUsage),
      note: `extract AI error: ${err?.message || err}`,
    };
  }
}
