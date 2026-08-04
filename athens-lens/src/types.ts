export interface Credentials {
  email: string;
  password: string;
}

export interface Session {
  email: string;
  displayName: string;
  authenticatedAt: string;
}

export interface AuthStore {
  restore(): Promise<Session | null>;
  signIn(credentials: Credentials): Promise<Session>;
  signOut(): Promise<void>;
}

export type WorkMode = "Remote" | "Hybrid" | "On-site";

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: WorkMode;
  employmentType: string;
  postedAt: string;
  summary: string;
  description: string;
  responsibilities: readonly string[];
  qualifications: readonly string[];
  applyUrl: string;
}

export interface JobsRepository {
  listJobs(): Promise<readonly Job[]>;
}
