import { Navigate } from "react-router";
import { useAuth } from "@/context/auth-context";
import { PATHS } from "../../config/routes";
import { LandingPage } from "./LandingPage";

export function GuestHome() {
  const { isAuthenticated, authReady } = useAuth();
  if (!authReady) return null;
  if (isAuthenticated) return <Navigate to={PATHS.jobs} replace />;
  return <LandingPage />;
}
