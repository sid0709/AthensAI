import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onIdTokenChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { invalidateCachedGet } from "@/api/cached-get";
import { API_BASE } from "@/lib/api-base";
import { firebaseAuth, firebaseConfigured } from "@/lib/firebase-client";

export type AuthUser = {
  _id: string;
  uid: string;
  email?: string | null;
  name: string;
  profileId?: string | null;
  tier?: string | null;
  role?: string | null;
  permission?: string | null;
};

type AuthResult = { success: boolean; message?: string; user?: AuthUser };
type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  authReady: boolean;
  signin: (email: string, password: string) => Promise<AuthResult>;
  signup: (email: string, password: string) => Promise<AuthResult>;
  signout: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  authReady: false,
  signin: async () => ({ success: false }),
  signup: async () => ({ success: false }),
  signout: () => {},
});

function authMessage(error: unknown): string {
  const code = String((error as { code?: string })?.code || "");
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Email or password is incorrect.";
  }
  if (code.includes("too-many-requests")) return "Too many attempts. Wait a moment and try again.";
  return error instanceof Error ? error.message : "Sign in failed";
}

async function loadSession(): Promise<AuthUser> {
  const response = await fetch(`${API_BASE.replace(/\/$/, "")}/auth/session`, { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as { success?: boolean; user?: AuthUser; error?: string };
  if (!response.ok || !data.success || !data.user) {
    throw new Error(data.error || "This account has no Athens profile grant.");
  }
  return data.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => onIdTokenChanged(firebaseAuth, async (firebaseUser) => {
    try {
      if (!firebaseUser) {
        setUser(null);
        return;
      }
      setUser(await loadSession());
      invalidateCachedGet("/account_info");
    } catch (error) {
      console.error("Firebase session could not be mapped to an Athens profile", error);
      setUser(null);
      await signOut(firebaseAuth);
    } finally {
      setAuthReady(true);
    }
  }), []);

  const signin = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!firebaseConfigured) return { success: false, message: "Firebase web configuration is missing." };
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      const session = await loadSession();
      setUser(session);
      invalidateCachedGet("/account_info");
      return { success: true, user: session };
    } catch (error) {
      await signOut(firebaseAuth).catch(() => undefined);
      return { success: false, message: authMessage(error) };
    }
  }, []);

  // Production accounts are created by the migration/invitation workflow so a
  // browser cannot create an identity without an explicit profile grant.
  const signup = useCallback(async (): Promise<AuthResult> => ({
    success: false,
    message: "Account creation is invitation-only. Ask an administrator to grant a profile.",
  }), []);

  const signout = useCallback(() => {
    setUser(null);
    invalidateCachedGet("/account_info");
    void signOut(firebaseAuth);
  }, []);

  const value = useMemo(() => ({
    user,
    isAuthenticated: Boolean(user),
    authReady,
    signin,
    signup,
    signout,
  }), [user, authReady, signin, signup, signout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
