import type { MailThread } from "../../../types";

/** Prefer a real email address for SMTP To. */
export function extractEmailAddress(thread: MailThread): string {
  const direct = String(thread.fromEmail || "").trim();
  if (direct.includes("@")) return direct;

  const from = String(thread.from || "");
  const angle = from.match(/<([^>]+@[^>]+)>/);
  if (angle?.[1]) return angle[1].trim();

  const paren = from.match(/\(([^)]+@[^)]+)\)/);
  if (paren?.[1]) return paren[1].trim();

  const bare = from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (bare?.[0]) return bare[0];

  return "";
}

/** Plain-text body for AI reply context (HTML → text when needed). */
export function threadPlainText(thread: MailThread, max = 8000): string {
  const plain = String(thread.body || "").trim();
  if (plain && !looksLikeHtml(plain)) {
    return plain.slice(0, max);
  }

  const html = String(thread.bodyHtml || "").trim();
  if (html) {
    return htmlToPlainText(html).slice(0, max);
  }

  const preview = String(thread.prev || "").trim();
  return preview.slice(0, max);
}

function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(s);
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export type AiReplyIntentId =
  | "polite"
  | "accept"
  | "decline"
  | "thanks"
  | "clarify"
  | "custom";

export const AI_REPLY_INTENTS: {
  id: AiReplyIntentId;
  label: string;
  prompt: string;
}[] = [
  {
    id: "polite",
    label: "Polite reply",
    prompt:
      "Write a polite, concise professional reply. Acknowledge the message and respond appropriately without overcommitting.",
  },
  {
    id: "accept",
    label: "Accept",
    prompt:
      "Write a warm, concise reply that accepts or agrees with the invitation/request in a professional way.",
  },
  {
    id: "decline",
    label: "Decline",
    prompt:
      "Write a polite, concise decline. Be respectful and brief; do not invent a detailed excuse.",
  },
  {
    id: "thanks",
    label: "Thanks",
    prompt: "Write a short thank-you reply that acknowledges the message professionally.",
  },
  {
    id: "clarify",
    label: "Ask question",
    prompt:
      "Write a concise reply that asks one or two clarifying questions relevant to the original message.",
  },
  {
    id: "custom",
    label: "Custom",
    prompt: "",
  },
];
