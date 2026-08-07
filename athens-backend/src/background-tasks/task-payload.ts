import { MAIL_AI_LABEL_MAX_IDS } from './constants/task-types';
import { BACKGROUND_TASK_TYPES } from './constants/task-types';

export function normalizeTaskPayload(
  type: string,
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const raw = payload && typeof payload === 'object' ? payload : {};
  if (type === BACKGROUND_TASK_TYPES.MAIL_AI_LABEL) {
    const ids = Array.isArray(raw.messageIds)
      ? raw.messageIds.map((id) => String(id)).filter(Boolean)
      : [];
    if (!ids.length) {
      throw new Error('payload.messageIds is required for mail_ai_label');
    }
    return { messageIds: ids.slice(0, MAIL_AI_LABEL_MAX_IDS) };
  }
  return { ...raw };
}

export function publicTaskSnapshot(task: {
  id: string;
  requestId?: string | null;
  type: string;
  status: string;
  profileId?: string | null;
  applierName?: string | null;
  progress?: unknown;
  result?: unknown;
  error?: string | null;
  createdAt?: Date | null;
  startedAt?: Date | null;
  cancelRequestedAt?: Date | null;
  cancelAcknowledgedAt?: Date | null;
  finishedAt?: Date | null;
  updatedAt?: Date | null;
}) {
  return {
    id: task.id,
    requestId: task.requestId ?? null,
    type: task.type,
    status: task.status,
    profileId: task.profileId ?? null,
    applierName: task.applierName ?? null,
    progress: task.progress ?? {},
    result: task.result ?? null,
    error: task.error ?? null,
    createdAt: task.createdAt?.toISOString?.() ?? null,
    startedAt: task.startedAt?.toISOString?.() ?? null,
    cancelRequestedAt: task.cancelRequestedAt?.toISOString?.() ?? null,
    cancelAcknowledgedAt: task.cancelAcknowledgedAt?.toISOString?.() ?? null,
    finishedAt: task.finishedAt?.toISOString?.() ?? null,
    updatedAt: task.updatedAt?.toISOString?.() ?? null,
  };
}
