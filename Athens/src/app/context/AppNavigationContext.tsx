import { createContext, useContext } from "react";
import type { NavigateOptions } from "../config/routes";
import type { View } from "../types";

export type AppNavigationContextValue = {
  navigate: (view: View, options?: NavigateOptions) => void;
};

export const AppNavigationContext = createContext<AppNavigationContextValue | null>(null);

export function useAppNavigation() {
  const ctx = useContext(AppNavigationContext);
  if (!ctx) throw new Error("useAppNavigation must be used within AppNavigationContext");
  return ctx;
}

export function useAppNavigationOptional() {
  return useContext(AppNavigationContext);
}
