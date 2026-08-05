import { requestAthensApi } from "../api/athensApi";
import type { InboxMessage, InboxRepository, InboxSnapshot } from "../types";
import { MOCK_INBOX_MESSAGES, MOCK_UNREAD_COUNT } from "./mockInbox";

const DEFAULT_PAGE_SIZE = 15;

function isInboxMessage(value: unknown): value is InboxMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return ["id", "sender", "senderEmail", "subject", "preview", "receivedAt", "kind"]
    .every((key) => typeof message[key] === "string") &&
    typeof message.isUnread === "boolean" &&
    typeof message.bodyLoaded === "boolean" &&
    Array.isArray(message.body);
}

function isInboxSnapshot(value: unknown): value is InboxSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.accountEmail === "string" &&
    typeof snapshot.total === "number" &&
    typeof snapshot.unreadCount === "number" &&
    Array.isArray(snapshot.messages) &&
    snapshot.messages.every(isInboxMessage);
}

export const athensInboxRepository: InboxRepository = {
  async listMessages(session, options = {}) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      label: "Notify/Unnecessary",
    });
    const response = await requestAthensApi<InboxSnapshot>(
      `/athens-lens/gmail/messages?${query.toString()}`,
      { accessToken: session.accessToken },
    );
    if (!isInboxSnapshot(response)) throw new Error("Athens server returned an invalid Gmail response.");
    return {
      ...response,
      page,
      pageSize,
      hasMore: Boolean(response.hasMore),
    };
  },

  async loadMessageBodies(session, messageIds) {
    const ids = [...new Set(messageIds)].filter(Boolean);
    if (!ids.length) return [];
    const query = new URLSearchParams({
      ids: ids.join(","),
      label: "Notify/Unnecessary",
    });
    const response = await requestAthensApi<{ messages: InboxMessage[] }>(
      `/athens-lens/gmail/message-bodies?${query.toString()}`,
      { accessToken: session.accessToken },
    );
    if (!Array.isArray(response.messages) || !response.messages.every(isInboxMessage)) {
      throw new Error("Athens server returned invalid Gmail message content.");
    }
    return response.messages;
  }
};

export const mockInboxRepository: InboxRepository = {
  async listMessages(_session, options = {}) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
    const start = (page - 1) * pageSize;
    const slice = MOCK_INBOX_MESSAGES.slice(start, start + pageSize);
    return {
      accountEmail: "candidate@example.com",
      messages: slice,
      total: MOCK_INBOX_MESSAGES.length,
      unreadCount: MOCK_UNREAD_COUNT,
      page,
      pageSize,
      hasMore: start + pageSize < MOCK_INBOX_MESSAGES.length,
      label: "Notify/Unnecessary",
    };
  },

  async loadMessageBodies(_session, messageIds) {
    const requested = new Set(messageIds);
    return MOCK_INBOX_MESSAGES.filter((message) => requested.has(message.id));
  }
};
