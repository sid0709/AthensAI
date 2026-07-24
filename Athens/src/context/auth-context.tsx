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

type AuthResult = { success: boolean; message?: string; user?: AuthUser };
type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  authReady: boolean;
  signin: (name: string, password: string) => Promise<AuthResult>;
  signup: (name: string, password: string) => Promise<AuthResult>;
  signout: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  authReady: true,
  signin: async () => ({ success: false }),
  signup: async () => ({ success: false }),
  signout: () => {},
});

const AUTH_USER_KEY = "athens_auth_user";
const AUTH_EXPIRES_KEY = "athens_auth_expires_at";
const AUTH_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const AUTH_TOUCH_THROTTLE_MS = 60 * 1000;

function clearStoredAuth() {
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(AUTH_EXPIRES_KEY);
}

function loadValidUser(): AuthUser | null {
  const storedUser = localStorage.getItem(AUTH_USER_KEY);
  const expiresAt = Number(localStorage.getItem(AUTH_EXPIRES_KEY));
  if (!storedUser || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
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

function touchAuth() {
  if (localStorage.getItem(AUTH_USER_KEY)) {
    localStorage.setItem(AUTH_EXPIRES_KEY, String(Date.now() + AUTH_IDLE_TTL_MS));
  }
}

function apiMessage(error: unknown, fallback: string) {
  const value = error as { data?: { message?: string }; message?: string };
  return value?.data?.message || value?.message || fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => loadValidUser());
  const { post } = useApi(API_BASE);

  useEffect(() => {
    const check = () => {
      const valid = loadValidUser();
      if (!valid) setUser(null);
    };
    check();
    const id = window.setInterval(check, AUTH_CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

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
    for (const event of events) window.addEventListener(event, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onActivity);
    return () => {
      for (const event of events) window.removeEventListener(event, onActivity);
      document.removeEventListener("visibilitychange", onActivity);
    };
  }, [user]);

  const signin = useCallback(async (name: string, password: string): Promise<AuthResult> => {
    try {
      const result = await post("/auth/signin", { name, password }) as AuthResult;
      if (!result?.success || !result.user) return { success: false, message: result?.message || "Sign in failed" };
      setUser(result.user);
      persistAuth(result.user);
      invalidateCachedGet("/account_info");
      return { success: true, user: result.user };
    } catch (error) {
      return { success: false, message: apiMessage(error, "Sign in failed") };
    }
  }, [post]);

  const signup = useCallback(async (name: string, password: string): Promise<AuthResult> => {
    try {
      const result = await post("/auth/signup", { name, password }) as AuthResult;
      if (!result?.success || !result.user) return { success: false, message: result?.message || "Sign up failed" };
      setUser(result.user);
      persistAuth(result.user);
      invalidateCachedGet("/account_info");
      return { success: true, user: result.user };
    } catch (error) {
      return { success: false, message: apiMessage(error, "Sign up failed") };
    }
  }, [post]);

  const signout = useCallback(() => {
    setUser(null);
    clearStoredAuth();
    invalidateCachedGet("/account_info");
  }, []);

  const value = useMemo(() => ({
    user,
    isAuthenticated: Boolean(user),
    authReady: true,
    signin,
    signup,
    signout,
  }), [user, signin, signup, signout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
