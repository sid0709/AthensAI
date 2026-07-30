import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useApplier } from '@/context/applier-context';
import {
  cancelBackgroundTask,
  createBackgroundTask,
  getBackgroundTask,
  listActiveBackgroundTasks,
  streamBackgroundTaskEvents,
  type BackgroundTask,
  type BackgroundTaskEvent,
  type BackgroundTaskType,
} from '../api/backgroundTasks';

const TERMINAL = new Set(['cancelled', 'completed', 'completed_with_errors', 'failed']);
const ACTIVE = new Set(['queued', 'running', 'cancelling']);
const STATUS_ORDER: Record<BackgroundTask['status'], number> = {
  queued: 0,
  running: 1,
  cancelling: 2,
  cancelled: 3,
  completed: 3,
  completed_with_errors: 3,
  failed: 3,
};

type BackgroundTaskContextValue = {
  tasks: BackgroundTask[];
  connected: boolean;
  startTask: (type: BackgroundTaskType, payload: Record<string, unknown>) => Promise<BackgroundTask>;
  adoptTask: (task: BackgroundTask) => void;
  cancelTask: (taskId: string) => Promise<BackgroundTask>;
  latestTask: (type: BackgroundTaskType) => BackgroundTask | null;
  waitForTask: (taskId: string, signal?: AbortSignal) => Promise<BackgroundTask>;
  refresh: () => Promise<BackgroundTask[]>;
};

const BackgroundTaskContext = createContext<BackgroundTaskContextValue | null>(null);

function requestId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readStoredValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStoredValue(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage can be disabled by browser policy.
  }
}

function taskSort(left: BackgroundTask, right: BackgroundTask) {
  return Date.parse(right.createdAt || '0') - Date.parse(left.createdAt || '0');
}

function shouldAcceptTask(current: BackgroundTask | undefined, incoming: BackgroundTask) {
  if (!current) return true;
  const currentAt = Date.parse(current.updatedAt || current.createdAt || '');
  const incomingAt = Date.parse(incoming.updatedAt || incoming.createdAt || '');
  if (Number.isFinite(currentAt) && Number.isFinite(incomingAt)) {
    if (incomingAt < currentAt) return false;
    if (incomingAt > currentAt) return true;
  }
  return STATUS_ORDER[incoming.status] >= STATUS_ORDER[current.status];
}

function mergeSnapshot(
  current: Record<string, BackgroundTask>,
  incoming: BackgroundTask[],
) {
  let changed = false;
  const next = { ...current };
  for (const task of incoming) {
    if (!shouldAcceptTask(next[task.id], task)) continue;
    next[task.id] = task;
    changed = true;
  }
  return changed ? next : current;
}

export function BackgroundTaskProvider({ children }: { children: ReactNode }) {
  const { applier } = useApplier();
  const profileId = applier?._id != null ? String(applier._id) : '';
  const applierName = String(applier?.name || '');
  const [byId, setById] = useState<Record<string, BackgroundTask>>({});
  const [connected, setConnected] = useState(false);
  const tabId = useRef(requestId());
  const tasksRef = useRef(byId);
  const connectedRef = useRef(false);
  const waiters = useRef(new Map<string, Set<(task: BackgroundTask) => void>>());
  tasksRef.current = byId;
  connectedRef.current = connected;

  const mergeTask = useCallback((task: BackgroundTask) => {
    setById((current) => mergeSnapshot(current, [task]));
  }, []);

  const applyEvent = useCallback((message: BackgroundTaskEvent) => {
    const { data } = message;
    if (message.id && profileId) {
      writeStoredValue(`athens_background_event:${profileId}`, message.id);
    }
    if (message.event === 'snapshot' && Array.isArray(data.tasks)) {
      setById((current) => mergeSnapshot(current, data.tasks || []));
      return;
    }
    if (data.task) {
      mergeTask(data.task);
      return;
    }
    const taskId = String(data.taskId || '');
    if (!taskId) return;
    setById((current) => {
      const task = current[taskId];
      if (!task) return current;
			if (data.progress && typeof data.progress === 'object') {
				const eventAt = typeof data.updatedAt === 'string' ? Date.parse(data.updatedAt) : NaN;
				const taskAt = Date.parse(task.updatedAt || task.createdAt || '');
				if (Number.isFinite(eventAt) && Number.isFinite(taskAt) && eventAt < taskAt) return current;
				const status = typeof data.status === 'string'
					? data.status as BackgroundTask['status']
					: task.status;
				if (Number.isFinite(eventAt) && eventAt === taskAt && STATUS_ORDER[status] < STATUS_ORDER[task.status]) {
					return current;
				}
				return {
					...current,
					[taskId]: {
						...task,
						status,
						...(typeof data.updatedAt === 'string' ? { updatedAt: data.updatedAt } : {}),
						progress: { ...task.progress, ...data.progress },
					},
				};
			}
      if (message.event === 'task-cancel-requested') {
				const requestedAt = String(data.at || new Date().toISOString());
				if (TERMINAL.has(task.status) || Date.parse(requestedAt) < Date.parse(task.updatedAt || '')) return current;
        return {
          ...current,
          [taskId]: { ...task, status: 'cancelling', cancelRequestedAt: requestedAt, updatedAt: requestedAt },
        };
      }
      if (data.itemId && data.item) {
				const eventAt = typeof data.at === 'string' ? Date.parse(data.at) : NaN;
				const taskAt = Date.parse(task.updatedAt || task.createdAt || '');
				// A reconnect begins with a current snapshot and then replays the
				// stream cursor. Do not let an older per-item replay overwrite the
				// item state already contained in that snapshot.
				if (Number.isFinite(eventAt) && Number.isFinite(taskAt) && eventAt < taskAt) return current;
				if (TERMINAL.has(task.status) && Number.isFinite(eventAt) && Number.isFinite(taskAt) && eventAt <= taskAt) {
					return current;
				}
        return {
          ...current,
          [taskId]: {
            ...task,
            progress: {
              ...task.progress,
              items: { ...(task.progress.items || {}), [data.itemId]: data.item },
            },
          },
        };
      }
      return current;
    });
  }, [mergeTask, profileId]);

  const refresh = useCallback(async () => {
    if (!profileId) return [];
    const active = await listActiveBackgroundTasks(profileId);
		const activeIds = new Set(active.map((task) => task.id));
		const disappeared = Object.values(tasksRef.current).filter((task) =>
			ACTIVE.has(task.status) && !activeIds.has(task.id));
		const resolved = (await Promise.all(disappeared.map((task) =>
			getBackgroundTask(task.id).catch(() => null)))).filter(Boolean) as BackgroundTask[];
    setById((current) => mergeSnapshot(current, [...active, ...resolved]));
    return [...active, ...resolved];
  }, [profileId]);

  useEffect(() => {
    setById({});
    if (!profileId) return;
    let stopped = false;
		let leader = false;
		let electionInFlight = false;
		let streamController: AbortController | null = null;
		const channel = typeof BroadcastChannel !== 'undefined'
			? new BroadcastChannel(`athens-background-tasks:${profileId}`)
			: null;
		const locks = (navigator as Navigator & {
			locks?: {
				request: (
					name: string,
					options: { mode: 'exclusive'; ifAvailable: true },
					callback: (lock: unknown | null) => Promise<void>,
				) => Promise<void>;
			};
		}).locks;
		let useLeaseFallback = !locks;
		const leaseKey = `athens-background-stream-lease:${profileId}`;
		const leaseOwner = tabId.current;
		const leaseDurationMs = 6_000;
		type StreamLease = { owner: string; expiresAt: number };
		const readLease = (): StreamLease | null => {
			try {
				const value = JSON.parse(readStoredValue(leaseKey) || 'null') as StreamLease | null;
				return value && typeof value.owner === 'string' && Number.isFinite(value.expiresAt)
					? value
					: null;
			} catch {
				return null;
			}
		};
		const writeLease = () => {
			return writeStoredValue(leaseKey, JSON.stringify({
					owner: leaseOwner,
					expiresAt: Date.now() + leaseDurationMs,
				}));
		};
		const broadcast = (message: unknown) => {
			try { channel?.postMessage(message); } catch { /* channel closed */ }
		};
    void refresh().catch(() => undefined);

		channel?.addEventListener('message', (event: MessageEvent) => {
			const message = event.data as {
				kind?: string;
				connected?: boolean;
				event?: BackgroundTaskEvent;
				tasks?: BackgroundTask[];
			};
			if (message?.kind === 'event' && message.event) applyEvent(message.event);
			if (message?.kind === 'stream-status' && !leader) setConnected(Boolean(message.connected));
			if (message?.kind === 'state' && !leader && Array.isArray(message.tasks)) {
				setById((current) => mergeSnapshot(current, message.tasks || []));
			}
		});

		const waitForRetry = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve) => {
			if (signal.aborted) {
				resolve();
				return;
			}
			const timer = window.setTimeout(done, milliseconds);
			const aborted = () => {
				window.clearTimeout(timer);
				done();
			};
			function done() {
				signal.removeEventListener('abort', aborted);
				resolve();
			}
			signal.addEventListener('abort', aborted, { once: true });
		});

		const runLeaderStream = async (signal: AbortSignal) => {
			let retryMs = 1_000;
			while (!stopped && !signal.aborted) {
        try {
          const lastEventId = readStoredValue(`athens_background_event:${profileId}`);
          setConnected(true);
					broadcast({ kind: 'stream-status', connected: true });
          await streamBackgroundTaskEvents({
            profileId,
            lastEventId,
					signal,
					onEvent: (event) => {
						applyEvent(event);
						broadcast({ kind: 'event', event });
					},
          });
          retryMs = 1_000;
        } catch {
					if (signal.aborted) return;
        } finally {
          setConnected(false);
					broadcast({ kind: 'stream-status', connected: false });
        }
				await waitForRetry(retryMs, signal);
        retryMs = Math.min(10_000, retryMs * 2);
      }
    };

		const stopFallbackLeadership = () => {
			if (!useLeaseFallback || !leader) return;
			leader = false;
			const controller = streamController;
			streamController = null;
			controller?.abort();
			setConnected(false);
		};

		const becomeFallbackLeader = () => {
			if (stopped || leader) return;
			leader = true;
			const controller = new AbortController();
			streamController = controller;
			void runLeaderStream(controller.signal).finally(() => {
				if (streamController !== controller) return;
				leader = false;
				streamController = null;
			});
		};

		const attemptFallbackLeadership = () => {
			if (stopped || leader) return;
			const current = readLease();
			if (current && current.owner !== leaseOwner && current.expiresAt > Date.now()) return;
			if (!writeLease()) {
				// Storage can be disabled by browser policy. In that environment a
				// per-tab stream is the only viable fallback.
				becomeFallbackLeader();
				return;
			}
			const confirmed = readLease();
			if (confirmed?.owner === leaseOwner) becomeFallbackLeader();
		};

		const renewFallbackLease = () => {
			if (!useLeaseFallback || !leader) return;
			const current = readLease();
			if (current?.owner !== leaseOwner && current?.expiresAt && current.expiresAt > Date.now()) {
				stopFallbackLeadership();
				return;
			}
			writeLease();
		};

		const onLeaseChanged = (event: StorageEvent) => {
			if (!useLeaseFallback || event.key !== leaseKey || !leader) return;
			const current = readLease();
			if (current?.owner !== leaseOwner && current?.expiresAt && current.expiresAt > Date.now()) {
				stopFallbackLeadership();
			}
		};
		window.addEventListener('storage', onLeaseChanged);

		const attemptLeadership = () => {
			if (stopped || leader || electionInFlight) return;
			if (useLeaseFallback || !locks) {
				attemptFallbackLeadership();
				return;
			}
			electionInFlight = true;
			void locks.request(
				`athens-background-stream:${profileId}`,
				{ mode: 'exclusive', ifAvailable: true },
				async (lock) => {
					if (!lock || stopped) return;
					leader = true;
					streamController = new AbortController();
					try {
						await runLeaderStream(streamController.signal);
					} finally {
						leader = false;
						streamController = null;
					}
				},
			).catch(() => {
				// Web Locks can be disabled by browser policy even when the API exists.
				// Fall back to the same cross-tab lease used on insecure LAN origins.
				useLeaseFallback = true;
				attemptFallbackLeadership();
			}).finally(() => { electionInFlight = false; });
		};
		attemptLeadership();
		const election = window.setInterval(attemptLeadership, 2_000);
		const presence = window.setInterval(() => {
			if (leader) {
				renewFallbackLease();
				broadcast({ kind: 'stream-status', connected: connectedRef.current });
			}
		}, 2_000);
		const stateSync = window.setInterval(() => {
			if (leader) broadcast({ kind: 'state', tasks: Object.values(tasksRef.current) });
		}, 5_000);

    const fallback = window.setInterval(() => {
      if (!connectedRef.current) void refresh().catch(() => undefined);
    }, 5_000);
    return () => {
      stopped = true;
			streamController?.abort();
			window.clearInterval(election);
			window.clearInterval(presence);
			window.clearInterval(stateSync);
      window.clearInterval(fallback);
			window.removeEventListener('storage', onLeaseChanged);
			if (useLeaseFallback) {
				const current = readLease();
				if (current?.owner === leaseOwner) {
					removeStoredValue(leaseKey);
				}
			}
			channel?.close();
    };
  }, [applyEvent, profileId, refresh]);

  useEffect(() => {
    for (const [taskId, callbacks] of waiters.current) {
      const task = byId[taskId];
      if (!task || !TERMINAL.has(task.status)) continue;
      waiters.current.delete(taskId);
      for (const callback of callbacks) callback(task);
    }
  }, [byId]);

  const startTask = useCallback(async (type: BackgroundTaskType, payload: Record<string, unknown>) => {
    if (!profileId || !applierName) throw new Error('Select a profile before starting this task');
    const task = await createBackgroundTask({
      requestId: requestId(),
      type,
      profileId,
      applierName,
      payload,
    });
    mergeTask(task);
    return task;
  }, [applierName, mergeTask, profileId]);

  const cancelTask = useCallback(async (taskId: string) => {
		const previous = tasksRef.current[taskId];
    setById((current) => current[taskId]
      ? { ...current, [taskId]: { ...current[taskId], status: 'cancelling' } }
      : current);
		try {
			const task = await cancelBackgroundTask(taskId);
			mergeTask(task);
			return task;
		} catch (error) {
			// Roll back only our optimistic state. A newer server event always wins.
			if (previous) {
				setById((current) => {
					const optimistic = current[taskId];
					if (
						optimistic?.status !== 'cancelling'
						|| optimistic.updatedAt !== previous.updatedAt
					) return current;
					return { ...current, [taskId]: previous };
				});
			}
			throw error;
		}
  }, [mergeTask]);

  const latestTask = useCallback((type: BackgroundTaskType) => {
    const matching = Object.values(tasksRef.current)
      .filter((task) => task.type === type)
      .sort(taskSort);
    return matching.find((task) => ACTIVE.has(task.status)) || matching[0] || null;
  }, []);

  const waitForTask = useCallback((taskId: string, signal?: AbortSignal) => {
    const current = tasksRef.current[taskId];
    if (current && TERMINAL.has(current.status)) return Promise.resolve(current);
    return new Promise<BackgroundTask>((resolve, reject) => {
      const callbacks = waiters.current.get(taskId) || new Set();
      const done = (task: BackgroundTask) => {
        signal?.removeEventListener('abort', aborted);
        resolve(task);
      };
      const aborted = () => {
        callbacks.delete(done);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      callbacks.add(done);
      waiters.current.set(taskId, callbacks);
      if (signal?.aborted) aborted();
      else signal?.addEventListener('abort', aborted, { once: true });
    });
  }, []);

  const value = useMemo<BackgroundTaskContextValue>(() => ({
    tasks: Object.values(byId).sort(taskSort),
    connected,
    startTask,
    adoptTask: mergeTask,
    cancelTask,
    latestTask,
    waitForTask,
    refresh,
  }), [byId, cancelTask, connected, latestTask, mergeTask, refresh, startTask, waitForTask]);

  return <BackgroundTaskContext.Provider value={value}>{children}</BackgroundTaskContext.Provider>;
}

export function useBackgroundTasks() {
  const value = useContext(BackgroundTaskContext);
  if (!value) throw new Error('useBackgroundTasks must be used within BackgroundTaskProvider');
  return value;
}
