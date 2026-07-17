import { API_BASE } from "@/lib/api-base";

export type FirebaseStatus = {
  ok: boolean;
  firestoreOk?: boolean;
  storageOk?: boolean;
  projectId: string | null;
  storageBucket: string | null;
  credentialsConfigured: boolean;
  collectionCount?: number | null;
  error?: string | null;
  firestoreError?: string | null;
  storageError?: string | null;
  initError?: string | null;
};

export type FirebaseCollection = {
  id: string;
  path: string;
  documentCount: number | null;
};

export type FirebaseDocumentSummary = {
  id: string;
  path: string;
  createTime: string | null;
  updateTime: string | null;
  data: Record<string, unknown>;
  fieldCount: number;
};

export type FirebaseStorageFolder = {
  name: string;
  prefix: string;
};

export type FirebaseStorageFile = {
  name: string;
  fullPath: string;
  size: number;
  contentType: string | null;
  updated: string | null;
  timeCreated: string | null;
};

type ApiEnvelope<T> = T & { success?: boolean; error?: string };

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function q(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function fetchFirebaseStatus(): Promise<{ status: FirebaseStatus }> {
  const res = await fetch(`${API_BASE}/firebase/status`);
  return parseJson(res);
}

export async function fetchFirebaseCollections(parent = ""): Promise<{
  parentPath: string | null;
  collections: FirebaseCollection[];
}> {
  const res = await fetch(`${API_BASE}/firebase/collections${q({ parent })}`);
  return parseJson(res);
}

export async function fetchFirebaseDocuments(opts: {
  path: string;
  limit?: number;
  cursor?: string;
  orderField?: string;
}): Promise<{
  path: string;
  documents: FirebaseDocumentSummary[];
  count: number;
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}> {
  const res = await fetch(
    `${API_BASE}/firebase/documents${q({
      path: opts.path,
      limit: opts.limit,
      cursor: opts.cursor,
      orderField: opts.orderField,
    })}`,
  );
  return parseJson(res);
}

export async function fetchFirebaseDocument(path: string): Promise<{
  exists: boolean;
  path: string;
  document: FirebaseDocumentSummary;
  subcollections: FirebaseCollection[];
}> {
  const res = await fetch(`${API_BASE}/firebase/document${q({ path })}`);
  return parseJson(res);
}

export async function fetchFirebaseStorage(opts: {
  prefix?: string;
  pageToken?: string;
  limit?: number;
}): Promise<{
  bucket: string;
  prefix: string;
  folders: FirebaseStorageFolder[];
  files: FirebaseStorageFile[];
  nextPageToken: string | null;
}> {
  const res = await fetch(
    `${API_BASE}/firebase/storage${q({
      prefix: opts.prefix,
      pageToken: opts.pageToken,
      limit: opts.limit,
    })}`,
  );
  return parseJson(res);
}

export async function fetchFirebaseStorageUrl(path: string): Promise<{
  bucket: string;
  path: string;
  url: string;
  expiresInMs: number;
  contentType: string | null;
  size: number;
  name: string;
}> {
  const res = await fetch(`${API_BASE}/firebase/storage/url${q({ path })}`);
  return parseJson(res);
}

export async function searchFirebaseDocuments(body: {
  path: string;
  field: string;
  op?: string;
  value: unknown;
  limit?: number;
}): Promise<{
  path: string;
  documents: FirebaseDocumentSummary[];
  count: number;
}> {
  const res = await fetch(`${API_BASE}/firebase/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}
