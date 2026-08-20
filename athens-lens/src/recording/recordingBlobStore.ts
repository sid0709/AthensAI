import { recordingFileExtension } from "./recordingCapture";

const DB_NAME = "athens-lens-recordings";
const DB_VERSION = 1;
const STORE_NAME = "blobs";

export type StoredRecording = {
  sessionId: string;
  blob: Blob;
  mimeType: string;
  filename: string;
  byteLength: number;
};

const memoryStore = new Map<string, StoredRecording>();

function openRecordingsDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Could not open recording storage."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "sessionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function putRecordingBlob(record: StoredRecording): Promise<void> {
  if (!record.sessionId || !record.blob?.size) return;

  const existing = await getRecordingBlob(record.sessionId);
  if (existing && existing.byteLength >= record.byteLength) return;

  const stored: StoredRecording = {
    sessionId: record.sessionId,
    blob: record.blob,
    mimeType: record.mimeType || record.blob.type || "video/webm",
    filename: record.filename
      || `athens-lens-recording-${Date.now()}.${recordingFileExtension(record.mimeType)}`,
    byteLength: record.byteLength || record.blob.size,
  };
  memoryStore.set(stored.sessionId, stored);

  try {
    const db = await openRecordingsDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not save recording."));
      tx.objectStore(STORE_NAME).put(stored);
    });
  } catch {
    // Memory copy is enough for the current document; IDB is the recycle path.
  }
}

export async function getRecordingBlob(sessionId: string): Promise<StoredRecording | null> {
  const key = String(sessionId || "");
  if (!key) return null;

  const fromMemory = memoryStore.get(key);
  if (fromMemory?.blob?.size) return fromMemory;

  try {
    const db = await openRecordingsDb();
    if (!db) return fromMemory ?? null;
    const stored = await new Promise<StoredRecording | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as StoredRecording | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not read recording."));
    });
    if (stored?.blob?.size) {
      memoryStore.set(key, stored);
      return stored;
    }
  } catch {
    // Fall through to memory.
  }

  return fromMemory ?? null;
}

export async function deleteRecordingBlob(sessionId: string): Promise<void> {
  const key = String(sessionId || "");
  if (!key) return;
  memoryStore.delete(key);

  try {
    const db = await openRecordingsDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not discard recording."));
      tx.objectStore(STORE_NAME).delete(key);
    });
  } catch {
    // Best-effort.
  }
}

export function resetRecordingBlobStoreForTests(): void {
  memoryStore.clear();
}
