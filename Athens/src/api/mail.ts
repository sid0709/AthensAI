import { API_BASE } from "@/lib/api-base";
import type { MailLabel, MailThread } from "@/app/types";

type ApiResult<T> = T & { success?: boolean; error?: string };

async function mailFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  const raw = await res.text();
  let data: ApiResult<T>;
  try {
    data = JSON.parse(raw) as ApiResult<T>;
  } catch {
    if (res.status === 504 || res.status === 502 || res.status === 503) {
      throw new Error(`Mail request timed out (HTTP ${res.status}). Try a smaller batch.`);
    }
    throw new Error(res.ok ? "Mail request returned invalid JSON" : `Mail request failed (HTTP ${res.status})`);
  }
  if (!res.ok || data.success === false) {
    throw new Error(data.error || "Mail request failed");
  }
  return data;
}

function qs(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export type MailThreadsResult = {
  threads: MailThread[];
  total: number;
  page: number;
  pageSize: number;
  fromCache?: boolean;
};

export async function fetchMailThreads(
  applierName: string,
  opts: {
    folder?: string;
    label?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    cacheOnly?: boolean;
    force?: string;
  } = {},
): Promise<MailThreadsResult> {
  const query = qs({
    applierName,
    folder: opts.folder,
    label: opts.label,
    search: opts.search,
    page: opts.page,
    pageSize: opts.pageSize,
    cacheOnly: opts.cacheOnly ? "true" : undefined,
    force: opts.force,
  });
  const data = await mailFetch<MailThreadsResult>(`mail/threads${query}`);
  return {
    threads: data.threads,
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
    fromCache: data.fromCache,
  };
}

export type FolderCounts = Record<string, { total: number; unread: number; badge: number }>;

export async function fetchMailFolderCounts(applierName: string, force = false) {
  const data = await mailFetch<{ counts: FolderCounts }>(
    `mail/folder-counts${qs({ applierName, force: force ? "true" : undefined })}`,
  );
  return data.counts;
}

export async function fetchMailMessage(applierName: string, uid: string, folder?: string) {
  const data = await mailFetch<{ thread: MailThread }>(
    `mail/messages/${encodeURIComponent(uid)}${qs({ applierName, folder })}`,
  );
  return data.thread;
}

export async function syncMailIncremental(applierName: string) {
  return mailFetch<{ newCount: number; updatedCount: number; skipped?: boolean }>("mail/sync", {
    method: "POST",
    body: JSON.stringify({ applierName }),
  });
}

export async function syncMailInitial(applierName: string) {
  return mailFetch<{ newCount: number; skipped?: boolean }>("mail/sync/initial", {
    method: "POST",
    body: JSON.stringify({ applierName }),
  });
}

export async function syncMailOlder(applierName: string, batchSize = 50) {
  return mailFetch<{ newCount: number; hasMore: boolean; skipped?: boolean }>("mail/sync/older", {
    method: "POST",
    body: JSON.stringify({ applierName, batchSize }),
  });
}

export async function sendMailMessage(
  applierName: string,
  payload: { to: string; subject: string; body: string; replyToUid?: string },
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    return await mailFetch<{ messageId: string }>("mail/send", {
      method: "POST",
      body: JSON.stringify({ applierName, ...payload }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("Send timed out. Check your network and Gmail app password, then try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function aiWriteMail(
  applierName: string,
  payload: {
    mode: "write" | "fine-tune" | "reply";
    prompt?: string;
    body?: string;
    subject?: string;
    replyContext?: string;
  },
) {
  return mailFetch<{ body: string; usage?: Record<string, unknown> }>("mail/ai-write", {
    method: "POST",
    body: JSON.stringify({ applierName, ...payload }),
  });
}

export async function patchMailMessage(
  applierName: string,
  uid: string,
  patch: {
    seen?: boolean;
    flagged?: boolean;
    folder?: string;
    addLabels?: string[];
    removeLabels?: string[];
    sourceFolder?: string;
  },
) {
  const data = await mailFetch<{ thread: MailThread }>(`mail/messages/${encodeURIComponent(uid)}`, {
    method: "PATCH",
    body: JSON.stringify({ applierName, ...patch }),
  });
  return data.thread;
}

export async function fetchMailLabels(applierName: string) {
  const data = await mailFetch<{ labels: MailLabel[] }>(`mail/labels${qs({ applierName })}`);
  return data.labels;
}

export async function saveMailLabels(applierName: string, labels: MailLabel[]) {
  const data = await mailFetch<{ labels: MailLabel[] }>("mail/labels", {
    method: "PUT",
    body: JSON.stringify({ applierName, labels }),
  });
  return data.labels;
}

export async function createMailLabel(applierName: string, name: string, parentId?: string) {
  const data = await mailFetch<{ label: MailLabel }>("mail/labels", {
    method: "POST",
    body: JSON.stringify({ applierName, name, parentId }),
  });
  return data.label;
}

export async function deleteMailLabel(applierName: string, labelId: string) {
  return mailFetch<{ deleted: string }>(
    `mail/labels/${encodeURIComponent(labelId)}${qs({ applierName })}`,
    { method: "DELETE", body: JSON.stringify({ applierName }) },
  );
}

export async function checkMailCredentials(applierName: string) {
  return mailFetch<{ configured: boolean; email?: string; error?: string }>(
    `mail/credentials${qs({ applierName })}`,
  );
}

export type MailLabelDefinitions = Record<string, string>;

export type MailAiLabelResult = {
  uid: number;
  label: string | null;
  applied: boolean;
  error?: string;
};

export async function fetchUnlabeledThreads(
  applierName: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<MailThreadsResult> {
  const query = qs({
    applierName,
    folder: "inbox",
    unlabeled: "true",
    page: opts.page,
    pageSize: opts.pageSize,
    cacheOnly: "true",
  });
  const data = await mailFetch<MailThreadsResult>(`mail/threads${query}`);
  return {
    threads: data.threads,
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
    fromCache: data.fromCache,
  };
}

export async function fetchMailLabelDefinitions(applierName: string) {
  const data = await mailFetch<{ definitions: MailLabelDefinitions }>(
    `mail/label-definitions${qs({ applierName })}`,
  );
  const definitions = data.definitions;
  return definitions && typeof definitions === "object" && !Array.isArray(definitions)
    ? definitions
    : {};
}

export async function saveMailLabelDefinitions(applierName: string, definitions: MailLabelDefinitions) {
  const data = await mailFetch<{ definitions: MailLabelDefinitions }>("mail/label-definitions", {
    method: "PUT",
    body: JSON.stringify({ applierName, definitions }),
  });
  const saved = data.definitions;
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
}

export async function runMailAiLabel(
  applierName: string,
  payload: {
    messages: { uid: number; mailbox?: string }[];
    labelDefinitions: MailLabelDefinitions;
  },
) {
  return mailFetch<{ results: MailAiLabelResult[]; usage?: Record<string, unknown> }>("mail/ai-label", {
    method: "POST",
    body: JSON.stringify({ applierName, ...payload }),
  });
}
