import { BriefcaseBusiness, Inbox, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import type { Session } from "../types";
import type { WorkspaceView } from "./routes";

interface WorkspaceSidebarProps {
  activeView: WorkspaceView;
  title: string;
  count: number;
  countLabel: string;
  inboxUnreadCount: number;
  session: Session;
  children: ReactNode;
  onNavigate(view: WorkspaceView): void;
  onLogout(): void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

export function WorkspaceSidebar({
  activeView,
  title,
  count,
  countLabel,
  inboxUnreadCount,
  session,
  children,
  onNavigate,
  onLogout
}: WorkspaceSidebarProps) {
  return (
    <aside className="job-navigation" aria-label={`${title} navigation`}>
      <header className="navigation-header">
        <div className="brand-lockup">
          <img src="/logo.png" alt="" />
          <span>Athens Lens</span>
        </div>
      </header>

      <nav className="workspace-navigation" aria-label="Workspace">
        <button
          type="button"
          aria-current={activeView === "jobs" ? "page" : undefined}
          onClick={() => onNavigate("jobs")}
        >
          <BriefcaseBusiness size={17} aria-hidden="true" />
          <span>Jobs</span>
        </button>
        <button
          type="button"
          aria-current={activeView === "inbox" ? "page" : undefined}
          onClick={() => onNavigate("inbox")}
        >
          <Inbox size={17} aria-hidden="true" />
          <span>Gmail inbox</span>
          {inboxUnreadCount > 0 ? <span className="navigation-badge">{inboxUnreadCount}</span> : null}
        </button>
      </nav>

      <div className="job-list-heading">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>{title}</h1>
        </div>
        <span className="job-count" aria-label={countLabel}>{count}</span>
      </div>

      {children}

      <footer className="user-footer">
        <span className="user-avatar" aria-hidden="true">{initials(session.displayName)}</span>
        <span className="user-copy">
          <strong>{session.displayName}</strong>
          <span>{session.email}</span>
        </span>
        <button className="icon-button" type="button" aria-label="Log out" onClick={onLogout}>
          <LogOut size={18} aria-hidden="true" />
        </button>
      </footer>
    </aside>
  );
}
