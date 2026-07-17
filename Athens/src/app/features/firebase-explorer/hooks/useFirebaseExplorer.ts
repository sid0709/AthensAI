import { useCallback, useEffect, useState } from "react";
import {
  fetchFirebaseCollections,
  fetchFirebaseDocument,
  fetchFirebaseDocuments,
  fetchFirebaseStatus,
  fetchFirebaseStorage,
  searchFirebaseDocuments,
  type FirebaseCollection,
  type FirebaseDocumentSummary,
  type FirebaseStatus,
  type FirebaseStorageFile,
  type FirebaseStorageFolder,
} from "../../../api/firebase";

export function useFirebaseStatus() {
  const [status, setStatus] = useState<FirebaseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFirebaseStatus();
      setStatus(res.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { status, loading, error, refetch };
}

export function useFirebaseCollections(parentPath: string) {
  const [collections, setCollections] = useState<FirebaseCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFirebaseCollections(parentPath);
      setCollections(res.collections);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCollections([]);
    } finally {
      setLoading(false);
    }
  }, [parentPath]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { collections, loading, error, refetch };
}

export function useFirebaseDocuments(collectionPath: string | null) {
  const [documents, setDocuments] = useState<FirebaseDocumentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(
    async (opts?: { append?: boolean; cursor?: string | null; search?: { field: string; value: string } }) => {
      if (!collectionPath) {
        setDocuments([]);
        setHasMore(false);
        setNextCursor(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (opts?.search?.field) {
          const res = await searchFirebaseDocuments({
            path: collectionPath,
            field: opts.search.field,
            value: opts.search.value,
            limit: 100,
          });
          setDocuments(res.documents);
          setHasMore(false);
          setNextCursor(null);
        } else {
          const res = await fetchFirebaseDocuments({
            path: collectionPath,
            limit: 50,
            cursor: opts?.cursor || undefined,
          });
          setDocuments((prev) => (opts?.append ? [...prev, ...res.documents] : res.documents));
          setHasMore(res.hasMore);
          setNextCursor(res.nextCursor);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (!opts?.append) setDocuments([]);
      } finally {
        setLoading(false);
      }
    },
    [collectionPath],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(() => {
    if (!hasMore || !nextCursor) return;
    void load({ append: true, cursor: nextCursor });
  }, [hasMore, nextCursor, load]);

  const filtered = filter.trim()
    ? documents.filter((d) => {
        const q = filter.toLowerCase();
        return d.id.toLowerCase().includes(q) || JSON.stringify(d.data).toLowerCase().includes(q);
      })
    : documents;

  return {
    documents: filtered,
    rawCount: documents.length,
    loading,
    error,
    hasMore,
    filter,
    setFilter,
    refetch: () => load(),
    loadMore,
    search: (field: string, value: string) => load({ search: { field, value } }),
  };
}

export function useFirebaseDocument(docPath: string | null) {
  const [document, setDocument] = useState<FirebaseDocumentSummary | null>(null);
  const [subcollections, setSubcollections] = useState<FirebaseCollection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docPath) {
      setDocument(null);
      setSubcollections([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchFirebaseDocument(docPath)
      .then((res) => {
        if (cancelled) return;
        setDocument(res.document);
        setSubcollections(res.subcollections);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setDocument(null);
        setSubcollections([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docPath]);

  return { document, subcollections, loading, error };
}

export function useFirebaseStorage(prefix: string) {
  const [folders, setFolders] = useState<FirebaseStorageFolder[]>([]);
  const [files, setFiles] = useState<FirebaseStorageFile[]>([]);
  const [bucket, setBucket] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { append?: boolean; pageToken?: string | null }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchFirebaseStorage({
          prefix,
          pageToken: opts?.pageToken || undefined,
          limit: 100,
        });
        setBucket(res.bucket);
        setFolders(res.folders);
        setFiles((prev) => (opts?.append ? [...prev, ...res.files] : res.files));
        setNextPageToken(res.nextPageToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (!opts?.append) {
          setFolders([]);
          setFiles([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [prefix],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return {
    bucket,
    folders,
    files,
    loading,
    error,
    hasMore: Boolean(nextPageToken),
    refetch: () => load(),
    loadMore: () => {
      if (!nextPageToken) return;
      void load({ append: true, pageToken: nextPageToken });
    },
  };
}
