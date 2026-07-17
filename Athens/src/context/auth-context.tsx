import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "@/api/useApi";
import { invalidateCachedGet } from "@/api/cached-get";
import { API_BASE } from "@/lib/api-base";

export type AuthUser = {
  _id: unknown;
  name: string;
  tier?: string | null;
  permission?: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  signin: (name: string, password: string) => Promise<{ success: boolean; message?: string; user?: AuthUser }>;
  signup: (name: string, password: string) => Promise<{ success: boolean; message?: string; user?: AuthUser }>;
  signout: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  signin: async () => ({ success: false }),
  signup: async () => ({ success: false }),
  signout: () => {},
});

const AUTH_USER_KEY = "athens_auth_user";
const AUTH_EXPIRES_KEY = "athens_auth_expires_at";
/** Sign out only after this long with no user activity. */
const AUTH_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** How often activity may extend the idle window (avoids constant localStorage writes). */
const AUTH_TOUCH_THROTTLE_MS = 60 * 1000;

function clearStoredAuth() {
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(AUTH_EXPIRES_KEY);
}

function loadValidUser(): AuthUser | null {
  const storedUser = localStorage.getItem(AUTH_USER_KEY);
  const storedExpiry = localStorage.getItem(AUTH_EXPIRES_KEY);
  if (!storedUser || !storedExpiry) {
    clearStoredAuth();
    return null;
  }
  const expiresAt = Number(storedExpiry);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    clearStoredAuth();
    return null;
  }
  try {
    return JSON.parse(storedUser) as AuthUser;
  } catch {
    clearStoredAuth();
    return null;
  }
}

function persistAuth(user: AuthUser) {
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  localStorage.setItem(AUTH_EXPIRES_KEY, String(Date.now() + AUTH_IDLE_TTL_MS));
}

/** Slide the idle expiry forward when the user is active. */
function touchAuth() {
  if (!localStorage.getItem(AUTH_USER_KEY)) return;
  localStorage.setItem(AUTH_EXPIRES_KEY, String(Date.now() + AUTH_IDLE_TTL_MS));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => loadValidUser());
  const { post } = useApi(API_BASE);

  useEffect(() => {
    const check = () => {
      const validUser = loadValidUser();
      if (!validUser) setUser((prev) => (prev ? null : prev));
    };
    check();
    const id = window.setInterval(check, AUTH_CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  // While signed in, any interaction resets the 1-day idle clock.
  useEffect(() => {
    if (!user) return;

    let lastTouch = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastTouch < AUTH_TOUCH_THROTTLE_MS) return;
      lastTouch = now;
      touchAuth();
    };

    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "focus"];
    for (const event of events) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onActivity);

    return () => {
      for (const event of events) {
        window.removeEventListener(event, onActivity);
      }
      document.removeEventListener("visibilitychange", onActivity);
    };
  }, [user]);

  const signin = useCallback(
    async (name: string, password: string) => {
      try {
        const res = (await post("/auth/signin", { name, password })) as {
          success?: boolean;
          user?: AuthUser;
          message?: string;
        };
        if (res?.success && res.user) {
          setUser(res.user);
          persistAuth(res.user);
          invalidateCachedGet("/account_info");
          return { success: true as const, user: res.user };
        }
        return { success: false as const, message: res?.message || "Sign in failed" };
      } catch (error: unknown) {
        const err = error as { data?: { message?: string }; message?: string };
        const message =
          err?.data && typeof err.data === "object" && err.data !== null && "message" in err.data
            ? String((err.data as { message?: string }).message)
            : err?.message || "Sign in failed";
        return { success: false as const, message };
      }
    },
    [post],
  );

  const signup = useCallback(
    async (name: string, password: string) => {
      try {
        const res = (await post("/auth/signup", { name, password })) as {
          success?: boolean;
          user?: AuthUser;
          message?: string;
        };
        if (res?.success && res.user) {
          setUser(res.user);
          persistAuth(res.user);
          invalidateCachedGet("/account_info");
          return { success: true as const, user: res.user };
        }
        return { success: false as const, message: res?.message || "Sign up failed" };
      } catch (error: unknown) {
        const err = error as { data?: { message?: string }; message?: string };
        const message =
          err?.data && typeof err.data === "object" && err.data !== null && "message" in err.data
            ? String((err.data as { message?: string }).message)
            : err?.message || "Sign up failed";
        return { success: false as const, message };
      }
    },
    [post],
  );

  const signout = useCallback(() => {
    setUser(null);
    clearStoredAuth();
    invalidateCachedGet("/account_info");
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      signin,
      signup,
      signout,
    }),
    [user, signin, signup, signout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
