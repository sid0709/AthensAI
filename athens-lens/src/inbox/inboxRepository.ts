import { requestAthensApi } from "../api/athensApi";
import type { InboxMessage, InboxRepository, InboxSnapshot } from "../types";
import { MOCK_INBOX_MESSAGES, MOCK_UNREAD_COUNT } from "./mockInbox";

function isInboxMessage(value: unknown): value is InboxMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return ["id", "sender", "senderEmail", "subject", "preview", "receivedAt", "kind"]
    .every((key) => typeof message[key] === "string") &&
    typeof message.isUnread === "boolean" &&
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
  async listMessages(session) {
    const response = await requestAthensApi<InboxSnapshot>("/athens-lens/gmail/messages", {
      accessToken: session.accessToken
    });
    if (!isInboxSnapshot(response)) throw new Error("Athens server returned an invalid Gmail response.");
    return response;
  }
};

export const mockInboxRepository: InboxRepository = {
  async listMessages() {
    return {
      accountEmail: "candidate@example.com",
      messages: MOCK_INBOX_MESSAGES,
      total: MOCK_INBOX_MESSAGES.length,
      unreadCount: MOCK_UNREAD_COUNT
    };
  }
};
