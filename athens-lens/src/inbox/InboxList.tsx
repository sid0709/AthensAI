import { KeyRound, Mail } from "lucide-react";
import { WorkspaceSidebar } from "../navigation/WorkspaceSidebar";
import type { WorkspaceView } from "../navigation/routes";
import type { InboxMessage, Session } from "../types";

interface InboxListProps {
  messages: readonly InboxMessage[];
  selectedMessageId: string | null;
  jobsCount: number;
  inboxUnreadCount: number;
  session: Session;
  onSelect(messageId: string): void;
  onNavigate(view: WorkspaceView): void;
  onLogout(): void;
}

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit"
});

export function InboxList({
  messages,
  selectedMessageId,
  jobsCount,
  inboxUnreadCount,
  session,
  onSelect,
  onNavigate,
  onLogout
}: InboxListProps) {
  return (
    <WorkspaceSidebar
      activeView="inbox"
      title="Inbox"
      count={messages.length}
      countLabel={`${messages.length} messages`}
      jobsCount={jobsCount}
      inboxUnreadCount={inboxUnreadCount}
      session={session}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <nav className="job-list" aria-label="Gmail messages">
        {messages.map((message) => (
          <button
            className={`job-list-item inbox-list-item${message.isUnread ? " inbox-list-item--unread" : ""}`}
            key={message.id}
            type="button"
            aria-current={selectedMessageId === message.id ? "page" : undefined}
            onClick={() => onSelect(message.id)}
          >
            <span className="job-list-icon" aria-hidden="true">
              {message.kind === "security-code" ? <KeyRound size={16} /> : <Mail size={16} />}
            </span>
            <span className="job-list-copy">
              <span className="inbox-sender-row">
                <strong>{message.sender}</strong>
                <time dateTime={message.receivedAt}>{TIME_FORMAT.format(new Date(message.receivedAt))}</time>
              </span>
              <span className="inbox-subject">{message.subject}</span>
              <span>{message.preview}</span>
            </span>
          </button>
        ))}
      </nav>
    </WorkspaceSidebar>
  );
}
