export interface Msg {
  id: string;
  role: "user" | "ai";
  content: string;
  ts: string;
}

export interface MailThread {
  id: string;
  uid?: number;
  mailbox?: string;
  from: string;
  fromEmail?: string;
  subj: string;
  prev: string;
  body: string;
  bodyHtml?: string | null;
  time: string;
  date?: string;
  unread: boolean;
  starred?: boolean;
  tag: string;
  folder: "inbox" | "sent" | "drafts" | "trash" | "spam" | "archive";
  labels: string[];
  gmailLabels?: string[];
  hasBody?: boolean;
}

export interface MailLabel {
  id: string;
  name: string;
  color: BadgeVariant;
  /** When set, this label is nested under the parent in the sidebar. */
  parentId?: string;
  /** Full Gmail label path (e.g. Notify/Decline) */
  path?: string;
  shortName?: string;
}

export interface Resume {
  id: string;
  name: string;
  version: string;
  updated: string;
  matchScore: number;
  skills: string[];
  isPrimary: boolean;
}

export type BadgeVariant =
  | "default"
  | "success"
  | "warn"
  | "err"
  | "violet"
  | "blue"
  | "subtle"
  | "amber"
  | "pink";
