import type { View } from "../types";

export const BETA_VIEWS = new Set<View>([
  "ats",
  "copilot",
  "calendar",
  "interviews",
  "reports",
]);

export function isBetaTier(tier: unknown): boolean {
  return String(tier ?? "").trim().toLowerCase() === "beta";
}

export function viewRequiresBeta(view: View): boolean {
  return BETA_VIEWS.has(view);
}

export function formatTierLabel(tier: unknown): string {
  return isBetaTier(tier) ? "Beta" : "Job seeker";
}
