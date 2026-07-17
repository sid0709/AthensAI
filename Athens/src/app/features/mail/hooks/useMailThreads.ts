import { useCallback, useRef, useState } from "react";
import {
  fetchMailMessage,
  fetchMailThreads,
  patchMailMessage,
  sendMailMessage,
} from "@/api/mail";
import type { MailFolderId } from "../../../data/mail";
import type { MailThread } from "../../../types";

type LoadOpts = {
  folder: MailFolderId;
  labelFilter: string | null;
  search: string;
  page: number;
  pageSize: number;
};

function mergeThreads(prev: MailThread[], fresh: MailThread[]): MailThread[] {
  const prevById = new Map(prev.map((t) => [t.id, t]));
  return fresh.map((t) => {
    const existing = prevById.get(t.id);
    const cached = existing?.hasBody && existing.bodyHtml ? existing : null;
    if (cached && cached.subj === t.subj && cached.from === t.from) {
      return {
        ...t,
        body: cached.body,
        bodyHtml: cached.bodyHtml,
        hasBody: true,
        prev: cached.prev || t.prev,
      };
    }
    if (t.hasBody) return t;
    return t;
  });
}

export function useMailThreads(applierName: string | undefined) {
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<MailThread | null>(null);
  const [aiAssist, setAiAssist] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [currentFolder, setCurrentFolder] = useState<MailFolderId>("inbox");
  const lastLoadOpts = useRef<LoadOpts>({
    folder: "inbox",
    labelFilter: null,
    search: "",
    page: 1,
    pageSize: 25,
  });
  const loadGen = useRef(0);
  const bodyFetchGen = useRef(0);
  const bodyCache = useRef(new Map<string, MailThread>());

  const loadThreads = useCallback(
    async (opts: Partial<LoadOpts> & { folder: MailFolderId; labelFilter: string | null; search: string; forceRefresh?: boolean }) => {
      if (!applierName) return;
      const merged: LoadOpts = {
        page: opts.page ?? lastLoadOpts.current.page,
        pageSize: opts.pageSize ?? lastLoadOpts.current.pageSize,
        folder: opts.folder,
        labelFilter: opts.labelFilter,
        search: opts.search,
      };
      lastLoadOpts.current = merged;
      setCurrentFolder(merged.folder);
      setPage(merged.page);
      setPageSize(merged.pageSize);

      const gen = ++loadGen.current;
      setError(null);
      setSyncing(true);
      setLoading(true);

      const queryOpts = {
        folder: merged.folder,
        label: merged.labelFilter ?? undefined,
        search: merged.search || undefined,
        page: merged.page,
        pageSize: merged.pageSize,
        force: opts.forceRefresh ? "true" : undefined,
      };

      try {
        const result = await fetchMailThreads(applierName, queryOpts);
        if (gen !== loadGen.current) return;
        setThreads((prev) => mergeThreads(prev, result.threads));
        setTotal(result.total);
      } catch (e) {
        if (gen !== loadGen.current) return;
        setError(e instanceof Error ? e.message : "Failed to load mail");
      } finally {
        if (gen === loadGen.current) {
          setLoading(false);
          setSyncing(false);
        }
      }
    },
    [applierName],
  );

  /** Prepend new threads from a delta sync (used after incremental sync on page 1). */
  const prependThreads = useCallback((newThreads: MailThread[]) => {
    setThreads((prev) => {
      const existingIds = new Set(prev.map((t) => t.id));
      const fresh = newThreads.filter((t) => !existingIds.has(t.id));
      if (!fresh.length) return prev;
      return [...fresh, ...prev];
    });
  }, []);

  const fetchThreadBody = useCallback(
    async (uid: string, folder: MailFolderId) => {
      if (!applierName) return null;

      const sessionHit = bodyCache.current.get(uid);
      if (sessionHit?.bodyHtml) {
        setThreads((prev) => prev.map((t) => (t.id === uid ? sessionHit : t)));
        return sessionHit;
      }

      const gen = ++bodyFetchGen.current;
      try {
        const thread = await fetchMailMessage(applierName, uid, folder);
        if (gen !== bodyFetchGen.current) return null;
        bodyCache.current.set(uid, thread);
        setThreads((prev) => prev.map((t) => (t.id === uid ? thread : t)));
        return thread;
      } catch (e) {
        if (gen !== bodyFetchGen.current) return null;
        console.error("fetch message body failed", e);
        return null;
      }
    },
    [applierName],
  );

  const getCachedThreadBody = useCallback((uid: string) => {
    return bodyCache.current.get(uid) ?? null;
  }, []);

  const cancelBodyFetch = useCallback(() => {
    bodyFetchGen.current += 1;
  }, []);

  const patchThread = useCallback(
    async (
      uid: string,
      patch: {
        seen?: boolean;
        flagged?: boolean;
        folder?: string;
        addLabels?: string[];
        removeLabels?: string[];
      },
    ) => {
      if (!applierName) return;
      try {
        const updated = await patchMailMessage(applierName, uid, {
          ...patch,
          sourceFolder: currentFolder,
        });
        setThreads((prev) => {
          if (patch.folder && patch.folder !== currentFolder) {
            return prev.filter((t) => t.id !== uid);
          }
          return prev.map((t) => (t.id === uid ? updated : t));
        });
        return updated;
      } catch (e) {
        console.error("patch message failed", e);
        return null;
      }
    },
    [applierName, currentFolder],
  );

  const applyLabel = useCallback(
    async (uids: string[], labelPath: string) => {
      if (!applierName || !labelPath || !uids.length) return;
      const label = labelPath.trim();
      if (!label) return;

      setThreads((prev) =>
        prev.map((t) => {
          if (!uids.includes(t.id)) return t;
          if (t.labels.includes(label)) return t;
          return { ...t, labels: [...t.labels, label], tag: t.tag || label };
        }),
      );

      await Promise.all(uids.map((uid) => patchThread(uid, { addLabels: [label] })));
    },
    [applierName, patchThread],
  );

  const star = useCallback(
    (id: string) => {
      const thread = threads.find((t) => t.id === id);
      const flagged = !(thread?.starred ?? false);
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, starred: flagged } : t)));
      void patchThread(id, { flagged });
    },
    [threads, patchThread],
  );

  const archive = useCallback(
    (id: string) => {
      setThreads((prev) => prev.filter((t) => t.id !== id));
      void patchThread(id, { folder: "archive" });
    },
    [patchThread],
  );

  const trash = useCallback(
    (id: string) => {
      setThreads((prev) => prev.filter((t) => t.id !== id));
      void patchThread(id, { folder: "trash" });
    },
    [patchThread],
  );

  const markUnread = useCallback(
    (id: string, unread: boolean) => {
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, unread } : t)));
      void patchThread(id, { seen: !unread });
    },
    [patchThread],
  );

  const openCompose = useCallback((thread?: MailThread | null, opts?: { aiAssist?: boolean }) => {
    setReplyTo(thread ?? null);
    setAiAssist(Boolean(opts?.aiAssist));
    setComposeOpen(true);
  }, []);

  const sendCompose = useCallback(
    async (to: string, subject: string, body: string) => {
      if (!applierName) {
        const err = new Error("No applier selected");
        setError(err.message);
        throw err;
      }
      setSending(true);
      try {
        await sendMailMessage(applierName, {
          to,
          subject,
          body,
          replyToUid: replyTo?.id,
        });
        setComposeOpen(false);
        setReplyTo(null);
        setAiAssist(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to send mail");
        throw e;
      } finally {
        setSending(false);
      }
    },
    [applierName, replyTo],
  );

  return {
    threads,
    composeOpen,
    setComposeOpen: (open: boolean) => {
      setComposeOpen(open);
      if (!open) {
        setReplyTo(null);
        setAiAssist(false);
      }
    },
    replyTo,
    aiAssist,
    openCompose,
    loading,
    syncing,
    sending,
    error,
    total,
    page,
    pageSize,
    setPage,
    setPageSize,
    currentFolder,
    loadThreads,
    prependThreads,
    fetchThreadBody,
    getCachedThreadBody,
    cancelBodyFetch,
    star,
    archive,
    trash,
    markUnread,
    applyLabel,
    sendCompose,
  };
}
