import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AlertCircle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { checkMailCredentials, fetchMailFolderCounts, type FolderCounts } from "@/api/mail";
import { useApplier } from "@/context/applier-context";
import { isBetaTier } from "../../lib/beta";
import { PaginationBar } from "../../components/shared/PaginationBar";
import { SearchField } from "../../components/shared/SearchField";
import { PATHS } from "../../config/routes";
import { MailSidebar } from "./components/MailSidebar";
import { MailDetailPane } from "./components/MailDetailPane";
import { MailComposeSheet } from "./components/MailComposeSheet";
import { MailAiLabelDialog } from "./components/MailAiLabelDialog";
import { ThreadList } from "./components/ThreadList";
import { useMailThreads } from "./hooks/useMailThreads";
import { useMailLabels } from "./hooks/useMailLabels";
import { useMailSync } from "./hooks/useMailSync";
import { groupThreadsByDate } from "./lib/mailLabelStyles";
import type { MailFolderId } from "../../../data/mail";
import type { MailThread } from "../../types";

export function MailPage() {
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const { applier, applierReady } = useApplier();
  const applierName = applier?.name;
  const isBeta = isBetaTier(applier?.tier);

  const [folder, setFolder] = useState<MailFolderId>("inbox");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [credentialsConfigured, setCredentialsConfigured] = useState<boolean | null>(null);
  const [folderCounts, setFolderCounts] = useState<FolderCounts | undefined>();
  const [activeThread, setActiveThread] = useState<MailThread | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [aiLabelOpen, setAiLabelOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const mail = useMailThreads(applierName);
  const { labels, createLabel, removeLabel, reload: reloadLabels } = useMailLabels(applierName);
  const {
    loadThreads,
    prependThreads,
    fetchThreadBody,
    getCachedThreadBody,
    cancelBodyFetch,
    page,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = mail;

  const refreshFolderCounts = useCallback(
    async (force = false) => {
      if (!applierName) return;
      try {
        const counts = await fetchMailFolderCounts(applierName, force);
        setFolderCounts(counts);
      } catch (e) {
        console.error("fetch folder counts failed", e);
      }
    },
    [applierName],
  );

  const loadCurrentPage = useCallback(() => {
    void loadThreads({ folder, labelFilter, search, page, pageSize });
  }, [loadThreads, folder, labelFilter, search, page, pageSize]);

  // Delta sync: prepend new messages instead of full page reload when on page 1
  // of inbox with no search/label filter active.
  const handleNewThreads = useCallback(
    (newThreads: import("../../types").MailThread[]) => {
      const isInboxView = folder === "inbox" && page === 1 && !labelFilter && !search;
      if (isInboxView) {
        prependThreads(newThreads);
      } else {
        // User is on a filtered/label view or a different page — full reload
        loadCurrentPage();
      }
    },
    [folder, page, labelFilter, search, prependThreads, loadCurrentPage],
  );

  const { runSync, syncing: backgroundSyncing } = useMailSync({
    applierName,
    applierReady,
    enabled: credentialsConfigured === true,
    onNewThreads: handleNewThreads,
    onSyncComplete: () => void refreshFolderCounts(),
  });

  const isSyncing = mail.syncing || backgroundSyncing;

  /** Force-refresh: hit IMAP synchronously (user clicked refresh button). */
  const forceRefresh = useCallback(() => {
    void loadThreads({ folder, labelFilter, search, page, pageSize, forceRefresh: true });
    void reloadLabels();
    void refreshFolderCounts(true);
    void runSync();
  }, [loadThreads, reloadLabels, refreshFolderCounts, runSync, folder, labelFilter, search, page, pageSize]);

  useEffect(() => {
    if (!applierReady || !applierName) return;
    void checkMailCredentials(applierName).then((r) => setCredentialsConfigured(r.configured));
  }, [applierReady, applierName]);

  useEffect(() => {
    if (!applierReady || !applierName || credentialsConfigured !== true) return;
    void refreshFolderCounts();
  }, [applierReady, applierName, credentialsConfigured, refreshFolderCounts]);

  useEffect(() => {
    if (!applierReady || !applierName || credentialsConfigured !== true) return;
    void loadThreads({ folder, labelFilter, search, page, pageSize });
    setSelectedIds(new Set());
  }, [applierReady, applierName, credentialsConfigured, folder, labelFilter, search, page, pageSize, loadThreads]);

  useEffect(() => {
    if (!threadId || !applierName) {
      setActiveThread(null);
      setDetailLoading(false);
      return;
    }

    cancelBodyFetch();
    const sessionCached = getCachedThreadBody(threadId);
    const listThread = mail.threads.find((t) => t.id === threadId) ?? null;
    const immediate = sessionCached ?? (listThread?.bodyHtml ? listThread : null);

    if (immediate?.bodyHtml) {
      setActiveThread(immediate);
      setDetailLoading(false);
      return;
    }

    setActiveThread(listThread);
    setDetailLoading(true);

    void fetchThreadBody(threadId, folder).then((thread) => {
      if (thread) setActiveThread(thread);
      setDetailLoading(false);
    });
  }, [threadId, applierName, folder, fetchThreadBody, getCachedThreadBody, cancelBodyFetch]);

  const grouped = useMemo(() => groupThreadsByDate(mail.threads), [mail.threads]);
  const isThreadView = Boolean(threadId);

  const openThread = (id: string) => {
    navigate(`${PATHS.mail}/${id}`);
    mail.markUnread(id, false);
    void refreshFolderCounts();
  };

  const handleMarkUnread = (id: string, unread: boolean) => {
    mail.markUnread(id, unread);
    void refreshFolderCounts();
  };

  const handleArchive = (id: string) => {
    mail.archive(id);
    void refreshFolderCounts();
  };

  const handleTrash = (id: string) => {
    mail.trash(id);
    void refreshFolderCounts();
  };

  const handleToggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleDropLabel = (threadId: string, labelPath: string) => {
    const targets =
      selectedIds.has(threadId) && selectedIds.size > 1
        ? [...selectedIds]
        : [threadId];
    void mail.applyLabel(targets, labelPath);
  };

  const handleSendCompose = async (to: string, subject: string, body: string) => {
    await mail.sendCompose(to, subject, body);
    void refreshFolderCounts(true);
    if (folder === "sent") {
      void loadThreads({ folder, labelFilter, search, page, pageSize, forceRefresh: true });
    }
  };

  const backToList = () => navigate(PATHS.mail);
  const resetList = () => navigate(PATHS.mail);

  const handleFolderChange = (f: MailFolderId) => {
    setFolder(f);
    setPage(1);
    resetList();
  };

  const handleLabelChange = (l: string | null) => {
    setLabelFilter(l);
    setPage(1);
    resetList();
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  if (!applierReady) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading account…
      </div>
    );
  }

  if (credentialsConfigured === false) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
          <h2 className="text-lg font-bold text-foreground">Gmail not configured</h2>
          <p className="text-sm text-muted-foreground">
            Add your Gmail address and app password in Settings → Profile to use Mail.
          </p>
          <Link
            to={`${PATHS.settings}/profile`}
            className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary/90"
          >
            Open Profile Settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      <MailSidebar
        folder={folder}
        labelFilter={labelFilter}
        labels={labels}
        folderCounts={folderCounts}
        onFolderChange={handleFolderChange}
        onLabelChange={handleLabelChange}
        onCreateLabel={(name, parentId) => createLabel(name, parentId)}
        onRemoveLabel={removeLabel}
        onCompose={() => mail.openCompose()}
      />

      {!isThreadView ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-3 border-b border-border flex-shrink-0 flex items-center gap-3">
            <SearchField
              value={search}
              onChange={handleSearchChange}
              placeholder="Search mail..."
              className="flex-1 max-w-xl"
            />
            {isBeta && (
              <button
                type="button"
                onClick={() => setAiLabelOpen(true)}
                className="flex items-center gap-2 bg-primary/10 hover:bg-primary/15 border border-primary/20 text-primary px-3 py-2 rounded-xl text-sm font-bold transition-colors min-h-10"
              >
                <Sparkles className="w-4 h-4" />
                AI Label
              </button>
            )}
            <button
              type="button"
              onClick={forceRefresh}
              disabled={isSyncing}
              className="icon-btn text-muted-foreground hover:text-foreground disabled:opacity-50"
              aria-label="Refresh mail"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
            </button>
          </div>

          {mail.error && (
            <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm border-b border-border">
              {mail.error}
            </div>
          )}

          <ThreadList
            grouped={grouped}
            loading={mail.loading}
            syncing={isSyncing}
            threadsLength={mail.threads.length}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onOpenThread={openThread}
            onStar={mail.star}
            onArchive={handleArchive}
            onTrash={handleTrash}
            onMarkUnread={handleMarkUnread}
            onDropLabel={handleDropLabel}
          />

          <div className="border-t border-border flex-shrink-0 px-3">
            <PaginationBar
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
                void loadThreads({
                  folder,
                  labelFilter,
                  search,
                  page: 1,
                  pageSize: size,
                  forceRefresh: true,
                });
              }}
              pageSizeOptions={[10, 25, 50, 100]}
              detailed
            />
          </div>
        </div>
      ) : (
        <MailDetailPane
          key={threadId}
          thread={activeThread}
          fullView
          loading={detailLoading}
          aiReplyEnabled={isBeta}
          onBack={backToList}
          onArchive={() => activeThread && handleArchive(activeThread.id)}
          onTrash={() => activeThread && handleTrash(activeThread.id)}
          onReply={() => activeThread && mail.openCompose(activeThread)}
          onAiReply={() => activeThread && mail.openCompose(activeThread, { aiAssist: true })}
        />
      )}

      <MailComposeSheet
        open={mail.composeOpen}
        onOpenChange={mail.setComposeOpen}
        onSend={handleSendCompose}
        sending={mail.sending}
        replyTo={mail.replyTo}
        aiAssist={mail.aiAssist}
      />

      {isBeta && (
        <MailAiLabelDialog
          open={aiLabelOpen}
          onOpenChange={setAiLabelOpen}
          applierName={applierName}
          labels={labels}
          onComplete={() => {
            loadCurrentPage();
            void refreshFolderCounts();
          }}
        />
      )}
    </div>
  );
}
