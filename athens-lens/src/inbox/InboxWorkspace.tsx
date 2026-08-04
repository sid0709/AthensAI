import { useEffect, useState } from "react";
import type { WorkspaceRoute, WorkspaceView } from "../navigation/routes";
import type { InboxMessage, InboxRepository, Session } from "../types";
import { InboxList } from "./InboxList";
import { MessageDetail } from "./MessageDetail";

interface InboxWorkspaceProps {
  session: Session;
  inboxRepository: InboxRepository;
  route: WorkspaceRoute;
  inboxUnreadCount: number;
  onNavigate(route: WorkspaceRoute): void;
  onNavigateView(view: WorkspaceView): void;
  onLogout(): Promise<void>;
}

export function InboxWorkspace({
  session,
  inboxRepository,
  route,
  inboxUnreadCount,
  onNavigate,
  onNavigateView,
  onLogout
}: InboxWorkspaceProps) {
  const [messages, setMessages] = useState<readonly InboxMessage[] | null>(null);

  useEffect(() => {
    let isActive = true;
    inboxRepository.listMessages().then((nextMessages) => {
      if (isActive) setMessages(nextMessages);
    });
    return () => {
      isActive = false;
    };
  }, [inboxRepository]);

  if (!messages) {
    return (
      <main className="app-status" role="status">
        <div className="status-logo"><MailStatusIcon /></div>
        <p>Loading Gmail inbox…</p>
      </main>
    );
  }

  const selectedMessageId = route.itemId ?? messages[0]?.id ?? null;
  const selectedMessage = messages.find((message) => message.id === selectedMessageId) ?? messages[0] ?? null;

  return (
    <main className={`workspace workspace--${route.itemId ? "detail" : "list"}`}>
      <InboxList
        messages={messages}
        selectedMessageId={selectedMessageId}
        inboxUnreadCount={inboxUnreadCount}
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
  return <span aria-hidden="true">✉</span>;
}
