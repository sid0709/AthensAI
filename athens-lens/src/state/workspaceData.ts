import type { InboxRepository, InboxSnapshot, Job, JobsRepository, Session } from "../types";
import { hasCachedInboxBody, useWorkspaceCache } from "./workspaceCache";

const jobsInFlight = new WeakMap<JobsRepository, Map<string, Promise<readonly Job[]>>>();
const inboxInFlight = new WeakMap<InboxRepository, Map<string, Promise<InboxSnapshot>>>();
const bodiesInFlight = new WeakMap<InboxRepository, Map<string, Map<string, Promise<void>>>>();
const jobsRequestVersion = new Map<string, number>();
const inboxRequestVersion = new Map<string, number>();

function nextVersion(versions: Map<string, number>, profileId: string): number {
  const version = (versions.get(profileId) ?? 0) + 1;
  versions.set(profileId, version);
  return version;
}

function requestsFor<T extends object, V>(registry: WeakMap<T, Map<string, V>>, owner: T): Map<string, V> {
  const existing = registry.get(owner);
  if (existing) return existing;
  const created = new Map<string, V>();
  registry.set(owner, created);
  return created;
}

export function refreshJobs(session: Session, repository: JobsRepository): Promise<readonly Job[]> {
  const requests = requestsFor(jobsInFlight, repository);
  const existing = requests.get(session.profileId);
  if (existing) return existing;
  const version = nextVersion(jobsRequestVersion, session.profileId);

  const request = Promise.resolve().then(() => repository.listJobs(session)).then((jobs) => {
    if (jobsRequestVersion.get(session.profileId) === version) {
      useWorkspaceCache.getState().setJobs(session.profileId, jobs);
    }
    return jobs;
  }).finally(() => {
    if (requests.get(session.profileId) === request) requests.delete(session.profileId);
  });
  requests.set(session.profileId, request);
  return request;
}

export function refreshInbox(session: Session, repository: InboxRepository): Promise<InboxSnapshot> {
  const requests = requestsFor(inboxInFlight, repository);
  const existing = requests.get(session.profileId);
  if (existing) return existing;
  const version = nextVersion(inboxRequestVersion, session.profileId);

  const request = Promise.resolve().then(() => repository.listMessages(session)).then((snapshot) => {
    if (inboxRequestVersion.get(session.profileId) === version) {
      useWorkspaceCache.getState().setInbox(session.profileId, snapshot);
    }
    return snapshot;
  }).finally(() => {
    if (requests.get(session.profileId) === request) requests.delete(session.profileId);
  });
  requests.set(session.profileId, request);
  return request;
}

export async function loadInboxBodies(
  session: Session,
  repository: InboxRepository,
  messageIds: readonly string[]
): Promise<void> {
  const profileRequests = requestsFor(bodiesInFlight, repository);
  let messageRequests = profileRequests.get(session.profileId);
  if (!messageRequests) {
    messageRequests = new Map<string, Promise<void>>();
    profileRequests.set(session.profileId, messageRequests);
  }

  const uniqueIds = [...new Set(messageIds)].filter(Boolean);
  const waits = uniqueIds.flatMap((messageId) => {
    if (hasCachedInboxBody(session.profileId, messageId)) return [];
    const existing = messageRequests!.get(messageId);
    return existing ? [existing] : [];
  });
  const pendingIds = uniqueIds.filter((messageId) =>
    !hasCachedInboxBody(session.profileId, messageId) && !messageRequests!.has(messageId)
  );

  if (pendingIds.length) {
    const request = Promise.resolve().then(() => repository.loadMessageBodies(session, pendingIds)).then((messages) => {
      useWorkspaceCache.getState().setMessageBodies(session.profileId, messages);
      const returnedIds = new Set(messages.map((message) => message.id));
      const missingIds = pendingIds.filter((messageId) => !returnedIds.has(messageId));
      if (missingIds.length) throw new Error("Some Gmail messages could not be loaded.");
    }).finally(() => {
      for (const messageId of pendingIds) {
        if (messageRequests!.get(messageId) === request) messageRequests!.delete(messageId);
      }
      if (messageRequests!.size === 0) profileRequests.delete(session.profileId);
    });
    for (const messageId of pendingIds) messageRequests.set(messageId, request);
    waits.push(request);
  }

  await Promise.all(waits);
}

export async function warmWorkspaceLists(
  session: Session,
  jobsRepository: JobsRepository,
  inboxRepository: InboxRepository
): Promise<void> {
  await Promise.allSettled([
    refreshJobs(session, jobsRepository),
    refreshInbox(session, inboxRepository)
  ]);
}

export function invalidateWorkspaceRequests(profileId: string): void {
  nextVersion(jobsRequestVersion, profileId);
  nextVersion(inboxRequestVersion, profileId);
}
