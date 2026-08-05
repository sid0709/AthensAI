import { afterEach, describe, expect, it, vi } from "vitest";
import { athensInboxRepository } from "./inboxRepository";
import { MOCK_INBOX_MESSAGES, MOCK_UNREAD_COUNT } from "./mockInbox";
import type { Session } from "../types";

const SESSION: Session = {
  username: "Alex",
  displayName: "Alex",
  profileId: "profile-1",
  authenticatedAt: "2026-08-04T12:00:00.000Z",
  expiresAt: "2099-08-04T12:00:00.000Z",
  accessToken: "gmail-token"
};

describe("athensInboxRepository", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads real Gmail data using the Athens Lens session", async () => {
    const snapshot = {
      accountEmail: "alex@example.com",
      messages: MOCK_INBOX_MESSAGES,
      total: MOCK_INBOX_MESSAGES.length,
      unreadCount: MOCK_UNREAD_COUNT,
      hasMore: false,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(athensInboxRepository.listMessages(SESSION)).resolves.toEqual({
      ...snapshot,
      page: 1,
      pageSize: 15,
      hasMore: false,
    });
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/athens-lens/gmail/messages?");
    expect(String(url)).toContain("label=Notify%2FUnnecessary");
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer gmail-token");
  });

  it("loads Gmail bodies separately with a bounded ID query", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        success: true,
        messages: [MOCK_INBOX_MESSAGES[0]]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(athensInboxRepository.loadMessageBodies(SESSION, ["42", "43", "42"]))
      .resolves.toEqual([MOCK_INBOX_MESSAGES[0]]);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/athens-lens/gmail/message-bodies?ids=42%2C43");
    expect(String(url)).toContain("label=Notify%2FUnnecessary");
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer gmail-token");
  });
});
