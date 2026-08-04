export interface Credentials {
  username: string;
  password: string;
}

export interface Session {
  username: string;
  displayName: string;
  profileId: string;
  authenticatedAt: string;
  expiresAt: string;
  accessToken: string;
}

export interface AuthStore {
  restore(): Promise<Session | null>;
  signIn(credentials: Credentials): Promise<Session>;
  signOut(): Promise<void>;
}

export type WorkMode = string;

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: WorkMode;
  employmentType: string;
  seniority: string;
  salary: string;
  experience: string;
  postedAt: string;
  skills: readonly string[];
  tags: readonly string[];
  applicantsText: string;
  description: string;
  responsibilities: readonly string[];
  qualifications: readonly string[];
  applyUrl: string;
}

export interface JobsRepository {
  listJobs(session: Session): Promise<readonly Job[]>;
}

export type InboxMessageKind = "security-code" | "account" | "general";

export interface InboxMessage {
  id: string;
  sender: string;
  senderEmail: string;
  subject: string;
  preview: string;
  receivedAt: string;
  isUnread: boolean;
  kind: InboxMessageKind;
  securityCode?: string;
  body: readonly string[];
}

export interface InboxRepository {
  listMessages(): Promise<readonly InboxMessage[]>;
}
