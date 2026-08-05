import { describe, expect, it } from "vitest";
import { MOCK_INBOX_MESSAGES, MOCK_UNREAD_COUNT } from "./mockInbox";

describe("mock Gmail inbox", () => {
  it("provides unique, complete messages and an accurate unread count", () => {
    expect(new Set(MOCK_INBOX_MESSAGES.map((message) => message.id)).size).toBe(MOCK_INBOX_MESSAGES.length);
    expect(MOCK_UNREAD_COUNT).toBe(MOCK_INBOX_MESSAGES.filter((message) => message.isUnread).length);

    for (const message of MOCK_INBOX_MESSAGES) {
      expect(message.sender).toBeTruthy();
      expect(message.subject).toBeTruthy();
      expect(message.body.length).toBeGreaterThan(0);
    }
  });

  it("gives every security-code message a six-digit code", () => {
    const codeMessages = MOCK_INBOX_MESSAGES.filter((message) => message.kind === "security-code");
    expect(codeMessages.length).toBeGreaterThan(0);

    for (const message of codeMessages) {
      expect(message.securityCode).toMatch(/^\d{6}$/);
    }
  });
});
