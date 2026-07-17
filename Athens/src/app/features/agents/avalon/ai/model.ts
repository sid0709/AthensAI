import { AI_MODEL } from "./config";

let profileDefaultModel: string | undefined;
let profileApplierName: string | undefined;

/** Called when the active applier profile loads or its default model changes. */
export function setProfileDefaultModel(model: string | undefined): void {
  const trimmed = model?.trim();
  profileDefaultModel = trimmed || undefined;
}

/** Active applier name — used to route chat through athens-server (profile API keys). */
export function setProfileApplierName(name: string | undefined): void {
  const trimmed = name?.trim();
  profileApplierName = trimmed || undefined;
}

export function getProfileApplierName(): string | undefined {
  return profileApplierName;
}

/** Resolve default model from profile fields (mirrors athens-server resolveDefaultModel). */
export function resolveProfileDefaultModel(
  profile: Record<string, unknown> | undefined,
): string | undefined {
  if (!profile) return undefined;

  const saved = String(profile.defaultModel ?? "").trim();
  if (saved) return saved;

  let provider = profile.defaultProvider;
  if (provider !== "openai" && provider !== "deepseek") {
    provider = profile.deepseekApiKey ? "deepseek" : profile.openaiApiKey ? "openai" : undefined;
  }
  if (provider === "openai") {
    return "gpt-4o-mini";
  }
  if (provider === "deepseek") {
    return "deepseek-v4-flash";
  }
  return undefined;
}

/** Per-request override → profile default → VITE_AI_MODEL → ai-bff env default. */
export function resolveChatModel(requestModel?: string): string | undefined {
  const explicit = requestModel?.trim();
  if (explicit) return explicit;
  if (profileDefaultModel) return profileDefaultModel;
  return AI_MODEL;
}
