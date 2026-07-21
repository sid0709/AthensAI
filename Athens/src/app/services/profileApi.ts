import { API_BASE } from "@/lib/api-base";
import {
  buildProfileSavePayload,
  emptyProfile,
  mapProfileFromApi,
  type UserProfile,
} from "../data/settings/profile";
import { streamSSE } from "../features/resumes/lib/sse";

export type NotificationPrefs = {
  applications: boolean;
  interviews: boolean;
  jobs: boolean;
  agents: boolean;
  mail: boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  applications: true,
  interviews: true,
  jobs: true,
  agents: true,
  mail: true,
};

async function parseJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function fetchAutoBidProfile(applierName: string): Promise<{
  profile: UserProfile;
  vendorAllowed: boolean;
  vendorPasswordSet: boolean;
  accountExists: boolean;
}> {
  const url = `${API_BASE.replace(/\/$/, "")}/personal/auto-bid-profile?applierName=${encodeURIComponent(applierName)}`;
  const res = await fetch(url);
  const data = (await parseJson(res)) as {
    success?: boolean;
    accountExists?: boolean;
    vendorAllowed?: boolean;
    vendorPasswordSet?: boolean;
    profile?: Record<string, unknown>;
  } | null;

  if (!res.ok || !data?.success) {
    throw new Error("Could not load profile");
  }

  return {
    profile: mapProfileFromApi(data.profile),
    vendorAllowed: Boolean(data.vendorAllowed),
    vendorPasswordSet: Boolean(data.vendorPasswordSet),
    accountExists: data.accountExists !== false,
  };
}

export async function setVendorAccessPassword(
  applierName: string,
  vendorPassword: string,
): Promise<{ success: boolean; message?: string }> {
  const url = `${API_BASE.replace(/\/$/, "")}/auth/vendor-password`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, vendorPassword }),
  });
  const data = (await parseJson(res)) as { success?: boolean; message?: string } | null;
  return { success: Boolean(data?.success), message: data?.message };
}

export async function clearVendorAccessPassword(
  applierName: string,
): Promise<{ success: boolean; message?: string }> {
  const url = `${API_BASE.replace(/\/$/, "")}/auth/vendor-password`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, clear: true }),
  });
  const data = (await parseJson(res)) as { success?: boolean; message?: string } | null;
  return { success: Boolean(data?.success), message: data?.message };
}

export async function saveAutoBidProfile(
  applierName: string,
  profile: UserProfile,
  vendorAllowed: boolean,
): Promise<{ success: boolean; error?: string }> {
  const url = `${API_BASE.replace(/\/$/, "")}/personal/auto-bid-profile`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildProfileSavePayload(profile, applierName, vendorAllowed)),
  });
  const data = (await parseJson(res)) as { success?: boolean; error?: string } | null;
  if (!res.ok || !data?.success) {
    return { success: false, error: data?.error || "Save failed" };
  }
  return { success: true };
}

/** Beta-only: refresh all generated résumé PDFs/identity from the current profile (no LLM). */
export async function refreshGeneratedResumesIdentity(applierName: string): Promise<{
  success: boolean;
  updated?: number;
  pdfs?: number;
  total?: number;
  error?: string;
  betaRequired?: boolean;
}> {
  const url = `${API_BASE.replace(/\/$/, "")}/personal/resume-generations/refresh-identity`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName }),
  });
  const data = (await parseJson(res)) as {
    success?: boolean;
    updated?: number;
    pdfs?: number;
    total?: number;
    error?: string;
    betaRequired?: boolean;
  } | null;
  if (!res.ok || !data?.success) {
    return {
      success: false,
      error: data?.error || "Refresh failed",
      betaRequired: Boolean(data?.betaRequired),
    };
  }
  return {
    success: true,
    updated: data.updated,
    pdfs: data.pdfs,
    total: data.total,
  };
}

export type RefreshResumesProgress = {
  done: number;
  total: number;
  left: number;
  updated: number;
  pdfs: number;
  skipped: number;
  failed: number;
  active: number;
  alreadyCurrent?: number;
  phase: string;
  profileUpdatedAt?: string | null;
  resumeUpdatedAt?: string | null;
};

/**
 * Beta-only streaming refresh with live progress (done / left / active).
 * Processes résumés in parallel on the server.
 */
export async function refreshGeneratedResumesIdentityStream(
  applierName: string,
  onProgress?: (progress: RefreshResumesProgress) => void,
  signal?: AbortSignal,
): Promise<{
  success: boolean;
  updated?: number;
  pdfs?: number;
  total?: number;
  skipped?: number;
  failed?: number;
  alreadyCurrent?: number;
  error?: string;
  betaRequired?: boolean;
}> {
  const url = `${API_BASE.replace(/\/$/, "")}/personal/resume-generations/refresh-identity/stream`;
  let donePayload: Record<string, unknown> | null = null;
  let streamError: string | null = null;
  let betaRequired = false;

  await streamSSE(
    url,
    { applierName },
    (event, data) => {
      if (event === "progress") {
        onProgress?.({
          done: Number(data.done ?? 0),
          total: Number(data.total ?? 0),
          left: Number(data.left ?? 0),
          updated: Number(data.updated ?? 0),
          pdfs: Number(data.pdfs ?? 0),
          skipped: Number(data.skipped ?? 0),
          failed: Number(data.failed ?? 0),
          active: Number(data.active ?? 0),
          alreadyCurrent: Number(data.alreadyCurrent ?? 0),
          phase: String(data.phase ?? "progress"),
          profileUpdatedAt: data.profileUpdatedAt ? String(data.profileUpdatedAt) : null,
          resumeUpdatedAt: data.resumeUpdatedAt ? String(data.resumeUpdatedAt) : null,
        });
        return;
      }
      if (event === "done") {
        donePayload = data;
        return;
      }
      if (event === "error") {
        streamError = String(data.error ?? "Refresh failed");
        betaRequired = Boolean(data.betaRequired);
      }
    },
    signal,
  );

  if (streamError) {
    return { success: false, error: streamError, betaRequired };
  }
  if (!donePayload) {
    return { success: false, error: "Refresh ended without a result" };
  }
  return {
    success: true,
    updated: Number(donePayload.updated ?? 0),
    pdfs: Number(donePayload.pdfs ?? 0),
    total: Number(donePayload.total ?? 0),
    skipped: Number(donePayload.skipped ?? 0),
    failed: Number(donePayload.failed ?? 0),
    alreadyCurrent: Number(donePayload.alreadyCurrent ?? 0),
  };
}

/** List available models for a provider (uses the profile's stored key for OpenAI). */
export async function fetchLlmModels(
  provider: "openai" | "deepseek",
  applierName: string,
): Promise<string[]> {
  const url = `${API_BASE.replace(/\/$/, "")}/personal/llm-models?provider=${provider}&applierName=${encodeURIComponent(applierName)}`;
  const res = await fetch(url);
  const data = (await parseJson(res)) as { success?: boolean; models?: string[] } | null;
  return Array.isArray(data?.models) ? data!.models! : [];
}

/** Validate the stored key for `provider` and set (provider, model) as the default. */
export async function setDefaultModel(
  applierName: string,
  provider: "openai" | "deepseek",
  model: string,
): Promise<{ success: boolean; valid: boolean; message?: string; error?: string }> {
  const url = `${API_BASE.replace(/\/$/, "")}/personal/default-model`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, provider, model }),
  });
  const data = (await parseJson(res)) as
    | { success?: boolean; valid?: boolean; message?: string; error?: string }
    | null;
  return {
    success: Boolean(data?.success),
    valid: Boolean(data?.valid),
    message: data?.message,
    error: data?.error,
  };
}

export async function testLlmKey(
  provider: "openai" | "deepseek",
  apiKey: string,
): Promise<{ ok: boolean; message?: string; models?: string[] }> {
  const url = `${API_BASE.replace(/\/$/, "")}/personal/llm-key-check`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey }),
  });
  const data = (await parseJson(res)) as { ok?: boolean; message?: string; models?: string[] } | null;
  return { ok: Boolean(data?.ok), message: data?.message, models: data?.models };
}

export async function fetchNotificationPrefs(applierName: string): Promise<NotificationPrefs> {
  const url = `${API_BASE.replace(/\/$/, "")}/settings/notifications?applierName=${encodeURIComponent(applierName)}`;
  const res = await fetch(url);
  const data = (await parseJson(res)) as { success?: boolean; prefs?: Partial<NotificationPrefs> } | null;
  if (!res.ok || !data?.success) return DEFAULT_NOTIFICATION_PREFS;
  return { ...DEFAULT_NOTIFICATION_PREFS, ...data.prefs };
}

export async function saveNotificationPrefs(
  applierName: string,
  prefs: NotificationPrefs,
): Promise<{ success: boolean; error?: string }> {
  const url = `${API_BASE.replace(/\/$/, "")}/settings/notifications`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, ...prefs }),
  });
  const data = (await parseJson(res)) as { success?: boolean; error?: string } | null;
  if (!res.ok || !data?.success) {
    return { success: false, error: data?.error || "Save failed" };
  }
  return { success: true };
}

export async function changePassword(
  name: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ success: boolean; message?: string }> {
  const url = `${API_BASE.replace(/\/$/, "")}/auth/change-password`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, currentPassword, newPassword }),
  });
  const data = (await parseJson(res)) as { success?: boolean; message?: string } | null;
  return { success: Boolean(data?.success), message: data?.message };
}

export async function deleteAccount(
  name: string,
  password: string,
  confirmName: string,
): Promise<{ success: boolean; message?: string }> {
  const url = `${API_BASE.replace(/\/$/, "")}/auth/delete-account`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password, confirmName }),
  });
  const data = (await parseJson(res)) as { success?: boolean; message?: string } | null;
  return {
    success: Boolean(data?.success),
    message: data?.message || (res.ok ? undefined : "Could not delete account"),
  };
}

export { emptyProfile };
