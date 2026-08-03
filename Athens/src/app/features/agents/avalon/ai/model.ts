import { resolveSavedProfileAiDefault } from "../../../../data/settings/profile";

let profileApplierName: string | undefined;
let profileId: string | undefined;

/** Active applier name — used to route chat through athens-server (profile API keys). */
export function setProfileApplierName(name: string | undefined): void {
  const trimmed = name?.trim();
  profileApplierName = trimmed || undefined;
}

export function getProfileApplierName(): string | undefined {
  return profileApplierName;
}

export function setProfileId(id: string | undefined): void {
  const trimmed = id?.trim();
  profileId = trimmed || undefined;
}

export function getProfileId(): string | undefined {
  return profileId;
}

/** Resolve only a valid saved Profile default (mirrors athens-server). */
export function resolveProfileDefaultModel(
  profile: Record<string, unknown> | undefined,
): string | undefined {
  return resolveSavedProfileAiDefault(profile)?.model;
}
