import { API_BASE } from '@/lib/api-base';
import { retryTransient } from '@/lib/transient-retry';

export type BackgroundTaskType =
  | 'resume_generation'
  | 'title_review'
  | 'skill_extraction'
  | 'resume_skill_analysis'
  | 'mail_ai_label'
  | 'job_analysis'
  | 'skill_enrichment'
  | 'job_removal'
  | 'resume_removal'
  | 'resume_identity_refresh';

export type BackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export type BackgroundTaskProgress = {
  total?: number | null;
  completed?: number;
  failed?: number;
  cancelled?: number;
  active?: number;
  remaining?: number | null;
  phase?: string | null;
  items?: Record<string, BackgroundTaskItem>;
  [key: string]: unknown;
};

export type BackgroundTaskItem = {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  step?: string | null;
  reused?: boolean;
  generationId?: string | null;
  error?: string;
  [key: string]: unknown;
};

export type BackgroundTask = {
  id: string;
  requestId?: string | null;
  type: BackgroundTaskType;
  status: BackgroundTaskStatus;
  profileId: string;
  applierName: string;
  progress: BackgroundTaskProgress;
  result?: Record<string, unknown> | null;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  cancelRequestedAt?: string | null;
  cancelAcknowledgedAt?: string | null;
  finishedAt?: string | null;
  updatedAt: string;
};

export type BackgroundTaskEvent = {
  id?: string;
  event: string;
  data: {
    taskId?: string;
    task?: BackgroundTask;
    tasks?: BackgroundTask[];
    itemId?: string;
    item?: BackgroundTaskItem;
    [key: string]: unknown;
  };
};

async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export async function createBackgroundTask(params: {
  requestId: string;
  type: BackgroundTaskType;
  profileId: string;
  applierName: string;
  payload: Record<string, unknown>;
}): Promise<BackgroundTask> {
  const response = await fetch(`${API_BASE}/background-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await parseJson<{ success: boolean; task: BackgroundTask }>(response);
  return data.task;
}

export async function listActiveBackgroundTasks(profileId: string): Promise<BackgroundTask[]> {
  const response = await fetch(
    `${API_BASE}/background-tasks?profileId=${encodeURIComponent(profileId)}&active=true`,
  );
  const data = await parseJson<{ success: boolean; tasks: BackgroundTask[] }>(response);
  return data.tasks || [];
}

export async function getBackgroundTask(taskId: string): Promise<BackgroundTask> {
  const response = await fetch(`${API_BASE}/background-tasks/${encodeURIComponent(taskId)}`);
  const data = await parseJson<{ success: boolean; task: BackgroundTask }>(response);
  return data.task;
}

export async function cancelBackgroundTask(taskId: string): Promise<BackgroundTask> {
  const response = await fetch(`${API_BASE}/background-tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
  });
  const data = await parseJson<{ success: boolean; task: BackgroundTask }>(response);
  return data.task;
}

export type ResumeGenerationTaskResult = {
  success: boolean;
  inputId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  partialSections?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  updatedAt?: string | null;
};

export async function enqueueResumeGenerationRequest(
  payload: Record<string, unknown>,
): Promise<{ task: BackgroundTask; inputId: string }> {
  const response = await fetch(`${API_BASE}/personal/resume-generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      requestId: globalThis.crypto?.randomUUID?.()
        || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
  });
  return parseJson<{ task: BackgroundTask; inputId: string }>(response);
}

export async function getResumeGenerationTaskResult(
  inputId: string,
  applierName?: string,
): Promise<ResumeGenerationTaskResult> {
  const query = applierName ? `?applierName=${encodeURIComponent(applierName)}` : '';
  const response = await fetch(
    `${API_BASE}/personal/resume-generation-tasks/${encodeURIComponent(inputId)}${query}`,
  );
  return parseJson<ResumeGenerationTaskResult>(response);
}

export async function getCompletedResumeGenerationTaskResult(
  inputId: string,
  applierName?: string,
  signal?: AbortSignal,
): Promise<ResumeGenerationTaskResult & { result: Record<string, unknown> }> {
  return retryTransient(async () => {
    const stored = await getResumeGenerationTaskResult(inputId, applierName);
    if (stored.result) {
      return stored as ResumeGenerationTaskResult & { result: Record<string, unknown> };
    }
    const terminalError = stored.status === 'failed' || stored.status === 'cancelled';
    throw Object.assign(
      new Error(stored.error || (terminalError
        ? `Resume generation ${stored.status}`
        : 'Resume generation result is still being finalized')),
      { status: terminalError ? 400 : 503 },
    );
  }, {
    signal,
    delaysMs: [200, 400, 800, 1_600, 3_200, 5_000],
  });
}

function parseEventBlock(block: string): BackgroundTaskEvent | null {
  let id: string | undefined;
  let event = 'message';
  let payload = '';
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) payload += line.slice(5).trim();
  }
  if (!payload) return null;
  try {
    return { id, event, data: JSON.parse(payload) as BackgroundTaskEvent['data'] };
  } catch {
    return null;
  }
}

export async function streamBackgroundTaskEvents(params: {
  profileId: string;
  lastEventId?: string | null;
  signal: AbortSignal;
  onEvent: (event: BackgroundTaskEvent) => void;
}): Promise<void> {
  const query = new URLSearchParams({ profileId: params.profileId });
  if (params.lastEventId) query.set('lastEventId', params.lastEventId);
  const response = await fetch(`${API_BASE}/background-tasks/events?${query}`, {
    signal: params.signal,
    headers: params.lastEventId ? { 'Last-Event-ID': params.lastEventId } : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `Task event stream failed (${response.status})`);
  }
  if (!response.body) throw new Error('Streaming responses are not supported');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let match = /\r?\n\r?\n/.exec(buffer);
      while (match?.index != null) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const event = parseEventBlock(block);
        if (event) params.onEvent(event);
        match = /\r?\n\r?\n/.exec(buffer);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export const backgroundTaskApiTest = { parseEventBlock };
