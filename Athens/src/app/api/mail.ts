import { API_BASE } from "@/lib/api-base";

/** One scanned inbox email, surfaced so the Agent Activity can show what was read. */
export interface ScannedEmail {
  index: number;
  from: string;
  subject: string;
  date: string | null;
}

export interface VerificationCodeResult {
  code: string | null;
  /** A verification LINK to open, when the email uses a click-to-verify flow instead of a code. */
  link: string | null;
  subject?: string | null;
  from?: string | null;
  /** How it was found: "regex" (fast path) or "ai" (fallback extractor). */
  via?: string | null;
  /** How many emails were scanned (for UI visibility). */
  scanned?: number;
  /** The actual emails scanned (titles/senders) — shown in the Agent Activity log. */
  emails?: ScannedEmail[];
  /** Why the AI did/didn't find a code (which email it picked, or the miss reason). */
  debug?: { selectedIndex: number | null; aiFound: boolean; note: string | null };
}

export interface VerificationCodeRequest {
  applierName: string;
  sinceMs?: number;
  /** When set, AI picks the OTP email that best matches this company (Greenhouse apply). */
  companyName?: string;
  jobTitle?: string;
}

/**
 * Fetch the most recent verification credential from the applier's inbox (IMAP Gmail).
 * Sends the 10 newest emails to AI with company/job context; AI returns the best-matching code.
 */
export async function requestVerificationCode(
  applierName: string,
  options?: Omit<VerificationCodeRequest, "applierName">,
  signal?: AbortSignal,
): Promise<VerificationCodeResult> {
  try {
    const res = await fetch(`${API_BASE}/mail/verification-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applierName,
        ...(options?.sinceMs ? { sinceMs: options.sinceMs } : {}),
        ...(options?.companyName ? { companyName: options.companyName } : {}),
        ...(options?.jobTitle ? { jobTitle: options.jobTitle } : {}),
      }),
      signal,
    });
    if (!res.ok) return { code: null, link: null };
    const data = (await res.json()) as {
      success?: boolean;
      code?: string | null;
      link?: string | null;
      subject?: string | null;
      from?: string | null;
      via?: string | null;
      scanned?: number;
      emails?: ScannedEmail[];
      debug?: { selectedIndex: number | null; aiFound: boolean; note: string | null };
    };
    if (!data.success) return { code: null, link: null };
    return {
      code: data.code ?? null,
      link: data.link ?? null,
      subject: data.subject,
      from: data.from,
      via: data.via,
      scanned: data.scanned,
      emails: data.emails,
      debug: data.debug,
    };
  } catch {
    return { code: null, link: null };
  }
}
