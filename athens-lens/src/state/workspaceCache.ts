import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import { storage } from "wxt/utils/storage";
import type { InboxMessage, InboxSnapshot, Job } from "../types";

const CACHE_STORAGE_KEY = "local:athens-lens:workspace-cache" as const;
const runtimeJobWrites = new Set<string>();
const runtimeInboxWrites = new Set<string>();
const runtimeBodyWrites = new Set<string>();

interface CachedValue<T> {
  data: T;
  refreshedAt: number;
}

type JobsCache = Record<string, CachedValue<readonly Job[]> | undefined>;
type InboxCache = Record<string, CachedValue<InboxSnapshot> | undefined>;
type BodyCache = Record<string, Record<string, CachedValue<InboxMessage> | undefined> | undefined>;

interface WorkspaceCacheState {
  jobsByProfile: JobsCache;
  inboxByProfile: InboxCache;
  bodiesByProfile: BodyCache;
  hydrated: boolean;
  setJobs(profileId: string, jobs: readonly Job[], refreshedAt?: number): void;
  setInbox(profileId: string, snapshot: InboxSnapshot, refreshedAt?: number): void;
  setMessageBodies(profileId: string, messages: readonly InboxMessage[], refreshedAt?: number): void;
  clearProfile(profileId: string): void;
  setHydrated(): void;
}

type PersistedWorkspaceCache = Pick<
  WorkspaceCacheState,
  "jobsByProfile" | "inboxByProfile" | "bodiesByProfile"
>;

const cacheStorageItem = storage.defineItem<StorageValue<PersistedWorkspaceCache> | null>(
  CACHE_STORAGE_KEY,
  { fallback: null }
);
let storageWriteQueue = Promise.resolve();

function queueStorageWrite(operation: () => Promise<void>): Promise<void> {
  const result = storageWriteQueue.then(operation, operation);
  storageWriteQueue = result.catch(() => undefined);
  return result;
}

const asyncWxtStorage: PersistStorage<PersistedWorkspaceCache, Promise<void>> = {
  getItem: () => cacheStorageItem.getValue(),
  setItem: (_name, value) => queueStorageWrite(() => cacheStorageItem.setValue(value)),
  removeItem: () => queueStorageWrite(() => cacheStorageItem.removeValue())
};

const initialCache = {
  jobsByProfile: {},
  inboxByProfile: {},
  bodiesByProfile: {},
  hydrated: false
};

function newerByProfile<T>(
  current: Record<string, CachedValue<T> | undefined>,
  persisted: Record<string, CachedValue<T> | undefined> | undefined,
  preferCurrent = new Set<string>()
): Record<string, CachedValue<T> | undefined> {
  const merged = { ...(persisted ?? {}) };
  for (const profileId of preferCurrent) {
    if (!current[profileId]) delete merged[profileId];
  }
  for (const [profileId, value] of Object.entries(current)) {
    if (!value) continue;
    if (preferCurrent.has(profileId) || !merged[profileId] || value.refreshedAt >= merged[profileId]!.refreshedAt) {
      merged[profileId] = value;
    }
  }
  return merged;
}

function newerBodies(
  current: BodyCache,
  persisted: BodyCache | undefined,
  preferCurrent = new Set<string>()
): BodyCache {
  const profileIds = new Set([...Object.keys(persisted ?? {}), ...Object.keys(current)]);
  return Object.fromEntries([...profileIds].map((profileId) => [
    profileId,
    preferCurrent.has(profileId)
      ? current[profileId] ?? {}
      : newerByProfile(current[profileId] ?? {}, persisted?.[profileId])
  ]));
}

export const useWorkspaceCache = create<WorkspaceCacheState>()(
  persist(
    (set) => ({
      ...initialCache,
      setJobs: (profileId, jobs, refreshedAt = Date.now()) => {
        runtimeJobWrites.add(profileId);
        set((state) => ({
          jobsByProfile: {
            ...state.jobsByProfile,
            [profileId]: { data: jobs, refreshedAt }
          }
        }));
      },
      setInbox: (profileId, snapshot, refreshedAt = Date.now()) => {
        runtimeInboxWrites.add(profileId);
        set((state) => {
          const liveIds = new Set(snapshot.messages.map((message) => message.id));
          const existingBodies = state.bodiesByProfile[profileId] ?? {};
          const retainedBodies = Object.fromEntries(
            Object.entries(existingBodies).filter(([messageId]) => liveIds.has(messageId))
          );
          return {
            inboxByProfile: {
              ...state.inboxByProfile,
              [profileId]: { data: snapshot, refreshedAt }
            },
            bodiesByProfile: {
              ...state.bodiesByProfile,
              [profileId]: retainedBodies
            }
          };
        });
      },
      setMessageBodies: (profileId, messages, refreshedAt = Date.now()) => {
        runtimeBodyWrites.add(profileId);
        set((state) => {
          const profileBodies = { ...(state.bodiesByProfile[profileId] ?? {}) };
          const liveIds = new Set(
            state.inboxByProfile[profileId]?.data.messages.map((message) => message.id) ?? []
          );
          for (const message of messages) {
            if (message.bodyLoaded && liveIds.has(message.id)) {
              profileBodies[message.id] = { data: message, refreshedAt };
            }
          }
          return {
            bodiesByProfile: {
              ...state.bodiesByProfile,
              [profileId]: profileBodies
            }
          };
        });
      },
      clearProfile: (profileId) => set((state) => {
        const jobsByProfile = { ...state.jobsByProfile };
        const inboxByProfile = { ...state.inboxByProfile };
        const bodiesByProfile = { ...state.bodiesByProfile };
        delete jobsByProfile[profileId];
        delete inboxByProfile[profileId];
        delete bodiesByProfile[profileId];
        runtimeJobWrites.add(profileId);
        runtimeInboxWrites.add(profileId);
        runtimeBodyWrites.add(profileId);
        return { jobsByProfile, inboxByProfile, bodiesByProfile };
      }),
      setHydrated: () => set({ hydrated: true })
    }),
    {
      name: "athens-lens-workspace-cache-v1",
      storage: asyncWxtStorage,
      version: 1,
      partialize: (state) => ({
        jobsByProfile: state.jobsByProfile,
        inboxByProfile: state.inboxByProfile,
        bodiesByProfile: state.bodiesByProfile
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<WorkspaceCacheState>;
        return {
          ...currentState,
          jobsByProfile: newerByProfile(
            currentState.jobsByProfile,
            persisted.jobsByProfile,
            runtimeJobWrites
          ),
          inboxByProfile: newerByProfile(
            currentState.inboxByProfile,
            persisted.inboxByProfile,
            runtimeInboxWrites
          ),
          bodiesByProfile: newerBodies(
            currentState.bodiesByProfile,
            persisted.bodiesByProfile,
            new Set([...runtimeBodyWrites, ...runtimeInboxWrites])
          )
        };
      },
      onRehydrateStorage: () => (state) => state?.setHydrated()
    }
  )
);

function matchingBody(
  profileId: string,
  envelope: InboxMessage,
  profileBodies = useWorkspaceCache.getState().bodiesByProfile[profileId]
): InboxMessage | null {
  const cached = profileBodies?.[envelope.id]?.data;
  if (!cached || !cached.bodyLoaded) return null;
  return cached.subject === envelope.subject && cached.receivedAt === envelope.receivedAt ? cached : null;
}

export function mergeCachedInboxBodies(
  profileId: string,
  snapshot: InboxSnapshot,
  profileBodies?: Record<string, CachedValue<InboxMessage> | undefined>
): InboxSnapshot {
  return {
    ...snapshot,
    messages: snapshot.messages.map((envelope) => {
      const body = matchingBody(profileId, envelope, profileBodies);
      if (!body) return envelope;
      return {
        ...envelope,
        preview: body.preview,
        kind: body.kind,
        securityCode: body.securityCode,
        body: body.body,
        bodyLoaded: true
      };
    })
  };
}

export function hasCachedInboxBody(profileId: string, messageId: string): boolean {
  const snapshot = useWorkspaceCache.getState().inboxByProfile[profileId]?.data;
  const envelope = snapshot?.messages.find((message) => message.id === messageId);
  return envelope ? matchingBody(profileId, envelope) !== null : false;
}

export async function resetWorkspaceCacheForTests(): Promise<void> {
  runtimeJobWrites.clear();
  runtimeInboxWrites.clear();
  runtimeBodyWrites.clear();
  useWorkspaceCache.setState(initialCache);
  await useWorkspaceCache.persist.clearStorage();
}
