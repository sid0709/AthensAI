import type { UserProfile } from "../data/settings/profile";
import { emptyProfile } from "../data/settings/profile";

const KEY = "athens-profile";

/** @deprecated Profile is stored in MongoDB via /personal/auto-bid-profile */
export function loadProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyProfile();
    return { ...emptyProfile(), ...JSON.parse(raw) };
  } catch {
    return emptyProfile();
  }
}

/** @deprecated Profile is stored in MongoDB via /personal/auto-bid-profile */
export function saveProfile(profile: UserProfile): void {
  localStorage.setItem(KEY, JSON.stringify(profile));
}
