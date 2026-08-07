import { resolveSavedProfileAiDefault } from "../../../data/settings/profile";

/** Resolve only a valid saved Profile default (mirrors athens-server). */
export function resolveProfileDefaultModel(
  profile: Record<string, unknown> | undefined,
): string | undefined {
  return resolveSavedProfileAiDefault(profile)?.model;
}
