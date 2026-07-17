/** AI BFF base URL — direct fallback when no applier profile is loaded. */
import { resolveDevServiceUrl } from "@/lib/api-base";

export const AI_BFF_URL = resolveDevServiceUrl(
  import.meta.env.VITE_AI_BFF_URL,
  "/ai-bff",
  "http://localhost:3920",
);

/** Env override — profile default (Settings → Default AI model) takes precedence when set. */
export const AI_MODEL = import.meta.env.VITE_AI_MODEL as string | undefined;

export const ANALYZE_TEMPERATURE = 0.3;
