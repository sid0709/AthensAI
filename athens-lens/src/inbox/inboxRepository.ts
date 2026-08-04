import type { InboxRepository } from "../types";
import { MOCK_INBOX_MESSAGES } from "./mockInbox";

export const mockInboxRepository: InboxRepository = {
  async listMessages() {
    return MOCK_INBOX_MESSAGES;
  }
};
