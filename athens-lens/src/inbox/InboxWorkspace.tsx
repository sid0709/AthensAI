import { AlertCircle, Mail, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AthensApiError } from "../api/athensApi";
import type { WorkspaceRoute, WorkspaceView } from "../navigation/routes";
import { mergeCachedInboxBodies, useWorkspaceCache } from "../state/workspaceCache";
import { loadInboxBodies, loadMoreInbox, refreshInbox } from "../state/workspaceData";
import type { InboxRepository, Session } from "../types";
import { InboxList } from "./InboxList";
import { MessageDetail } from "./MessageDetail";

interface InboxWorkspaceProps {
  session: Session;
  inboxRepository: InboxRepository;
  route: WorkspaceRoute;
  jobsCount: number;
  onNavigate(route: WorkspaceRoute): void;
  onNavigateView(view: WorkspaceView): void;
  onLogout(): Promise<void>;
}

export function InboxWorkspace({
  session,
  inboxRepository,
  route,
  jobsCount,
  onNavigate,
  onNavigateView,
  onLogout
}: InboxWorkspaceProps) {
  const cachedSnapshot = useWorkspaceCache((state) => state.inboxByProfile[session.profileId]?.data);
  const cachedBodies = useWorkspaceCache((state) => state.bodiesByProfile[session.profileId]);
  const snapshot = useMemo(
    () => cachedSnapshot ? mergeCachedInboxBodies(session.profileId, cachedSnapshot, cachedBodies) : undefined,
    [cachedBodies, cachedSnapshot, session.profileId]
  );
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [bodyError, setBodyError] = useState<{ key: string; message: string } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [bodyAttempt, setBodyAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const listRequestKey = `${session.profileId}:${loadAttempt}`;

  useEffect(() => {
    let isActive = true;
    refreshInbox(session, inboxRepository).then(
      () => undefined,
      (error) => {
        if (!isActive) return;
        setLoadError({
          key: listRequestKey,
          message: error instanceof AthensApiError ? error.message : "Gmail couldn't be loaded."
        });
      }
    );
    return () => {
      isActive = false;
    };
  }, [inboxRepository, listRequestKey, session]);

  const messages = snapshot?.messages ?? [];
  const selectedMessageId = route.itemId ?? messages[0]?.id ?? null;
  const selectedMessage = messages.find((message) => message.id === selectedMessageId) ?? messages[0] ?? null;
  const bodyRequestKey = `${selectedMessageId ?? "none"}:${bodyAttempt}`;
  const prefetchIds = messages
    .filter((message) => !message.bodyLoaded)
    .map((message) => message.id)
    .slice(0, 8)
    .join(",");

  // Prefetch visible page bodies so clicks hit cache instead of a cold IMAP round-trip.
  useEffect(() => {
    if (!prefetchIds) return;
    void loadInboxBodies(session, inboxRepository, prefetchIds.split(","));
  }, [inboxRepository, prefetchIds, session]);

  // Selected message: ensure body is loading (no-op when prefetch already cached).
  useEffect(() => {
    if (!selectedMessage || selectedMessage.bodyLoaded) return;
    let isActive = true;
    loadInboxBodies(session, inboxRepository, [selectedMessage.id]).catch((error) => {
      if (isActive) {
        setBodyError({
          key: bodyRequestKey,
          message: error instanceof Error ? error.message : "Message content couldn't be loaded."
        });
      }
    });
    return () => {
      isActive = false;
    };
  }, [bodyRequestKey, inboxRepository, selectedMessage, session]);

  const currentLoadError = loadError?.key === listRequestKey ? loadError.message : null;
  const currentBodyError = bodyError?.key === bodyRequestKey ? bodyError.message : null;

  async function handleLoadMore() {
    if (loadingMore || !snapshot?.hasMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      await loadMoreInbox(session, inboxRepository);
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : "Could not load more messages.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (!snapshot && !currentLoadError) {
    return (
      <main className="app-status" role="status">
        <div className="status-logo"><MailStatusIcon /></div>
        <p>Loading Notify/Unnecessary…</p>
      </main>
    );
  }

  if (!snapshot && currentLoadError) {
    return (
      <main className="app-status" role="status">
        <div className="status-logo"><AlertCircle size={22} aria-hidden="true" /></div>
        <p>{currentLoadError}</p>
        <div className="status-actions">
          <button className="secondary-button" type="button" onClick={() => {
            setLoadAttempt((current) => current + 1);
          }}>
            <RefreshCw size={16} aria-hidden="true" />Try again
          </button>
          <button className="text-button" type="button" onClick={() => void onLogout()}>Sign out</button>
        </div>
      </main>
    );
  }

  return (
    <main className={`workspace workspace--${route.itemId ? "detail" : "list"}`}>
      <InboxList
        messages={messages}
        selectedMessageId={selectedMessageId}
        jobsCount={jobsCount}
        inboxUnreadCount={snapshot?.unreadCount ?? 0}
        session={session}
        hasMore={Boolean(snapshot?.hasMore)}
        loadingMore={loadingMore}
        loadMoreError={loadMoreError}
        onLoadMore={() => void handleLoadMore()}
        onSelect={(messageId) => onNavigate({ view: "inbox", itemId: messageId })}
        onNavigate={onNavigateView}
        onLogout={() => void onLogout()}
      />
      {selectedMessage ? (
        <MessageDetail
          message={selectedMessage}
          bodyError={currentBodyError}
          onRetry={() => setBodyAttempt((current) => current + 1)}
          onBack={() => onNavigate({ view: "inbox" })}
        />
      ) : null}
    </main>
  );
}

function MailStatusIcon() {
  return <Mail size={22} aria-hidden="true" />;
}
