import { WorkspaceSidebar } from "../navigation/WorkspaceSidebar";
import type { WorkspaceView } from "../navigation/routes";
import type { InboxMessage, Session } from "../types";
import { MailSenderIcon } from "./MailSenderIcon";

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

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric"
});

const YEAR_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric"
});

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return TIME_FORMAT.format(date);
  return date.getFullYear() === now.getFullYear() ? DAY_FORMAT.format(date) : YEAR_FORMAT.format(date);
}

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
            <MailSenderIcon message={message} size="list" />
            <span className="job-list-copy">
              <span className="inbox-sender-row">
                <strong>{message.sender}</strong>
                <time dateTime={message.receivedAt}>{formatMessageTime(message.receivedAt)}</time>
              </span>
              <span className="inbox-subject">{message.subject}</span>
              <span>{message.preview || (message.bodyLoaded ? "" : "Loading preview…")}</span>
            </span>
          </button>
        ))}
      </nav>
    </WorkspaceSidebar>
  );
}
