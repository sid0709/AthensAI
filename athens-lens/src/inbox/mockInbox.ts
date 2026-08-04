import type { InboxMessage } from "../types";

export const MOCK_INBOX_MESSAGES = [
  {
    id: "mail-001",
    sender: "Northstar Careers",
    senderEmail: "security@example.com",
    subject: "Your verification code is 482917",
    preview: "Use this code to continue signing in to your candidate account.",
    receivedAt: "2026-08-04T15:42:00.000Z",
    isUnread: true,
    kind: "security-code",
    securityCode: "482917",
    body: [
      "We received a request to verify your candidate account.",
      "Enter the security code below to continue. This code expires in 10 minutes.",
      "If you did not request this code, you can safely ignore this email."
    ]
  },
  {
    id: "mail-002",
    sender: "Cedar & Coast Recruiting",
    senderEmail: "recruiting@example.com",
    subject: "Interview availability",
    preview: "We would like to find a time for your first conversation.",
    receivedAt: "2026-08-04T14:08:00.000Z",
    isUnread: true,
    kind: "general",
    body: [
      "Thank you for your interest in the Customer Operations Lead role.",
      "We would like to schedule a short introductory conversation. Please reply with a few times that work well for you this week."
    ]
  },
  {
    id: "mail-003",
    sender: "Candidate Portal",
    senderEmail: "accounts@example.com",
    subject: "Sign-in code: 731204",
    preview: "Your temporary sign-in code is ready.",
    receivedAt: "2026-08-04T12:25:00.000Z",
    isUnread: true,
    kind: "security-code",
    securityCode: "731204",
    body: [
      "Use the code below to finish signing in.",
      "For your security, the code can only be used once and expires shortly."
    ]
  },
  {
    id: "mail-004",
    sender: "Fieldnote Studio",
    senderEmail: "updates@example.com",
    subject: "Application received",
    preview: "Thanks for applying. Our team will review your materials soon.",
    receivedAt: "2026-08-03T18:11:00.000Z",
    isUnread: false,
    kind: "account",
    body: [
      "Your application has been received successfully.",
      "Our team is reviewing applications and will contact you if your experience matches the role."
    ]
  },
  {
    id: "mail-005",
    sender: "Juniper House Talent",
    senderEmail: "talent@example.com",
    subject: "A quick follow-up",
    preview: "We have one additional question about your application.",
    receivedAt: "2026-08-03T16:03:00.000Z",
    isUnread: false,
    kind: "general",
    body: [
      "Thank you for sharing your background with us.",
      "Could you confirm your preferred start date? A short reply is all we need."
    ]
  },
  {
    id: "mail-006",
    sender: "Common Thread",
    senderEmail: "notifications@example.com",
    subject: "Candidate profile updated",
    preview: "The changes to your candidate profile were saved.",
    receivedAt: "2026-08-02T20:36:00.000Z",
    isUnread: false,
    kind: "account",
    body: [
      "Your candidate profile was updated successfully.",
      "No further action is needed. You can return to the portal whenever you would like to make another change."
    ]
  }
] as const satisfies readonly InboxMessage[];

export const MOCK_UNREAD_COUNT = MOCK_INBOX_MESSAGES.filter((message) => message.isUnread).length;
