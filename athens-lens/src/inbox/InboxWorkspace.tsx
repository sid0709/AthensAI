import { AlertCircle, Mail, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { AthensApiError } from "../api/athensApi";
import type { WorkspaceRoute, WorkspaceView } from "../navigation/routes";
import type { InboxRepository, InboxSnapshot, Session } from "../types";
import { InboxList } from "./InboxList";
import { MessageDetail } from "./MessageDetail";

interface InboxWorkspaceProps {
  session: Session;
  inboxRepository: InboxRepository;
  route: WorkspaceRoute;
  jobsCount: number;
  onInboxLoaded(unreadCount: number): void;
  onNavigate(route: WorkspaceRoute): void;
  onNavigateView(view: WorkspaceView): void;
  onLogout(): Promise<void>;
}

export function InboxWorkspace({
  session,
  inboxRepository,
  route,
  jobsCount,
  onInboxLoaded,
  onNavigate,
  onNavigateView,
  onLogout
}: InboxWorkspaceProps) {
  const [loadState, setLoadState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; snapshot: InboxSnapshot }
  >({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let isActive = true;
    inboxRepository.listMessages(session).then(
      (snapshot) => {
        if (!isActive) return;
        setLoadState({ status: "ready", snapshot });
        onInboxLoaded(snapshot.unreadCount);
      },
      (error) => {
        if (!isActive) return;
        setLoadState({
          status: "error",
          message: error instanceof AthensApiError ? error.message : "Gmail couldn't be loaded."
        });
      }
    );
    return () => {
      isActive = false;
    };
  }, [inboxRepository, loadAttempt, onInboxLoaded, session]);

  if (loadState.status === "loading") {
    return (
      <main className="app-status" role="status">
        <div className="status-logo"><MailStatusIcon /></div>
        <p>Loading Gmail inbox…</p>
      </main>
    );
  }

  if (loadState.status === "error") {
    return (
      <main className="app-status" role="status">
        <div className="status-logo"><AlertCircle size={22} aria-hidden="true" /></div>
        <p>{loadState.message}</p>
        <div className="status-actions">
          <button className="secondary-button" type="button" onClick={() => {
            setLoadState({ status: "loading" });
            setLoadAttempt((current) => current + 1);
          }}>
            <RefreshCw size={16} aria-hidden="true" />Try again
          </button>
          <button className="text-button" type="button" onClick={() => void onLogout()}>Sign out</button>
        </div>
      </main>
    );
  }

  const { messages } = loadState.snapshot;

  const selectedMessageId = route.itemId ?? messages[0]?.id ?? null;
  const selectedMessage = messages.find((message) => message.id === selectedMessageId) ?? messages[0] ?? null;

  return (
    <main className={`workspace workspace--${route.itemId ? "detail" : "list"}`}>
      <InboxList
        messages={messages}
        selectedMessageId={selectedMessageId}
        jobsCount={jobsCount}
        inboxUnreadCount={loadState.snapshot.unreadCount}
        session={session}
        onSelect={(messageId) => onNavigate({ view: "inbox", itemId: messageId })}
        onNavigate={onNavigateView}
        onLogout={() => void onLogout()}
      />
      {selectedMessage ? (
        <MessageDetail message={selectedMessage} onBack={() => onNavigate({ view: "inbox" })} />
      ) : null}
    </main>
  );
}

function MailStatusIcon() {
  return <Mail size={22} aria-hidden="true" />;
}
