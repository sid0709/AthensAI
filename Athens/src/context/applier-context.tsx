import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useAuth } from "@/context/auth-context";
import { API_BASE } from "@/lib/api-base";

export type ApplierAccount = {
  _id: unknown;
  name: string;
  tier?: string | null;
  permission?: string | null;
  autoBidProfile?: {
    deepseekApiKey?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ApplierContextValue = {
  applier: ApplierAccount | null;
  setApplier: Dispatch<SetStateAction<ApplierAccount | null>>;
  applierReady: boolean;
};

const ApplierContext = createContext<ApplierContextValue>({
  applier: null,
  setApplier: () => {},
  applierReady: false,
});

export function ApplierProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [applier, setApplier] = useState<ApplierAccount | null>(null);
  const [applierReady, setApplierReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user?.name) {
      setApplier(null);
      setApplierReady(true);
      return;
    }

    let cancelled = false;
    (async () => {
      setApplierReady(false);
      try {
        const res = await fetch(
          `${API_BASE.replace(/\/$/, "")}/account_info/by/${encodeURIComponent(user.name)}`,
        );
        const data = (await res.json()) as { success?: boolean; data?: ApplierAccount };
        if (cancelled) return;
        if (data?.success && data.data) {
          setApplier(data.data);
        } else {
          setApplier({
            _id: user._id,
            name: user.name,
            tier: user.tier,
            permission: user.permission,
          });
        }
      } catch (e) {
        console.error("account profile fetch failed", e);
        if (!cancelled) {
          setApplier({
            _id: user._id,
            name: user.name,
            tier: user.tier,
            permission: user.permission,
          });
        }
      } finally {
        if (!cancelled) setApplierReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?._id, user?.name, user?.tier, user?.permission]);

  const value = useMemo(() => ({ applier, setApplier, applierReady }), [applier, applierReady]);
  return <ApplierContext.Provider value={value}>{children}</ApplierContext.Provider>;
}

export function useApplier() {
  return useContext(ApplierContext);
}
