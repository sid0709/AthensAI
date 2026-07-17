import type { Msg } from "../../types";

export const COPILOT_CHIPS = [
  "Find roles matching my profile",
  "Tailor resume for Vercel role",
  "Draft follow-up for top 5 apps",
  "Prep me for Notion interview",
];

export const COPILOT_CONVERSATIONS = [
  "Role search — React/TS",
  "Resume tailoring",
  "Follow-up drafts",
  "Notion interview prep",
  "Offer negotiation",
];

export const COPILOT_QUICK_ACTIONS = [
  "Tailor resume",
  "Draft cover letter",
  "Follow-up email",
  "Interview prep",
  "Compare offers",
];

export const COPILOT_WORKFLOWS = [
  { n: "Auto-tailor resume", on: true },
  { n: "Follow-up seq.", on: true },
  { n: "Calendar sync", on: false },
];

export const INIT_MSGS: Msg[] = [
  { id: "m0", role: "ai", ts: "10:29 AM", content: "Good morning, Jordan. I'm your Career Copilot — ready to find roles, tailor your resume, prep for interviews, and automate follow-ups. What are we working on today?" },
  { id: "m1", role: "user", ts: "10:30 AM", content: "Find me top roles matching my React and TypeScript profile. I want high-growth startups with strong engineering culture." },
  { id: "m2", role: "ai", ts: "10:30 AM", content: "Scanned 847 listings against your profile. Here are your top three matches:\n\n**1. Vercel — Senior Frontend Engineer (94% match)**\nRemote · $160k–$200k. Owns design system work — perfect fit for your React/TS background.\n\n**2. Linear — Staff Engineer (93% match)**\nRemote · $200k–$260k. Performance-focused culture aligns with your portfolio.\n\n**3. Anthropic — Senior Frontend Engineer (83% match)**\nRemote · $165k–$210k. AI-native product, strong DX team.\n\nShall I tailor your resume for any of these, draft applications, or schedule prep sessions?" },
];

export const AI_REPLY =
  "I've processed your request. I can tailor your resume, draft follow-up emails, find matching roles, or prep you for upcoming interviews. What would you like to do next?";

export const TOP_APPLICATION_IDS = ["a01", "a09", "a10"];
