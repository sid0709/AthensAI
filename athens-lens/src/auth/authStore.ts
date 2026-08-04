import { storage } from "wxt/utils/storage";
import type { AuthStore, Credentials, Session } from "../types";

export const SESSION_STORAGE_KEY = "local:athens-lens:session" as const;

const sessionStorage = storage.defineItem<Session | null>(SESSION_STORAGE_KEY, {
  fallback: null
});

function deriveDisplayName(email: string): string {
  const localPart = email.split("@")[0] ?? "Athens user";
  const words = localPart
    .split(/[._+-]+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return "Athens user";
  }

  return words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export const demoAuthStore: AuthStore = {
  restore() {
    return sessionStorage.getValue();
  },

  async signIn(credentials: Credentials) {
    const email = credentials.email.trim().toLowerCase();
    const session: Session = {
      email,
      displayName: deriveDisplayName(email),
      authenticatedAt: new Date().toISOString()
    };

    await sessionStorage.setValue(session);
    return session;
  },

  async signOut() {
    await sessionStorage.removeValue();
  }
};
