import { storage } from "wxt/utils/storage";
import { requestAthensApi } from "../api/athensApi";
import type { AuthStore, Credentials, Session } from "../types";

export const SESSION_STORAGE_KEY = "local:athens-lens:session" as const;

const sessionStorage = storage.defineItem<Session | null>(SESSION_STORAGE_KEY, {
  fallback: null
});

interface SignInResponse {
  success: true;
  session: Session;
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return [
    "username",
    "displayName",
    "profileId",
    "authenticatedAt",
    "expiresAt",
    "accessToken"
  ].every((key) => typeof session[key] === "string" && session[key].length > 0);
}

export const athensAuthStore: AuthStore = {
  async restore() {
    const session = await sessionStorage.getValue();
    const expiresAt = Date.parse(session?.expiresAt || "");
    if (!session?.accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await sessionStorage.removeValue();
      return null;
    }
    return session;
  },

  async signIn(credentials: Credentials) {
    const username = credentials.username.trim();
    const response = await requestAthensApi<SignInResponse>("/athens-lens/auth/signin", {
      method: "POST",
      body: JSON.stringify({ username, password: credentials.password })
    });
    const session = response.session;
    if (!isSession(session)) throw new Error("Athens server returned an invalid sign-in response.");

    await sessionStorage.setValue(session);
    return session;
  },

  async signOut() {
    const session = await sessionStorage.getValue();
    try {
      if (session?.accessToken) {
        await requestAthensApi("/athens-lens/auth/signout", {
          method: "POST",
          accessToken: session.accessToken
        });
      }
    } catch {
      // Local logout must remain available if the server is offline. The
      // server-side session still expires automatically.
    } finally {
      await sessionStorage.removeValue();
    }
  }
};
