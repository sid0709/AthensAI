import type { ReactNode } from "react";
import { Loader2, LockKeyhole, Shield } from "lucide-react";
import { Link } from "react-router";
import { useApplier } from "@/context/applier-context";
import { PATHS } from "../config/routes";
import { PageShell } from "../components/layout/PageShell";
import { isAdminPermission } from "../lib/admin";

export function AdminRoute({ children }: { children: ReactNode }) {
  const { applier, applierReady } = useApplier();

  if (!applierReady) {
    return (
      <PageShell>
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading...
        </div>
      </PageShell>
    );
  }

  if (!isAdminPermission(applier?.permission)) {
    return (
      <PageShell>
        <div className="mx-auto mt-10 max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-rose-50 text-rose-700 ring-1 ring-rose-200">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-rose-700">
            <Shield className="h-3.5 w-3.5" />
            Admin
          </div>
          <h1 className="text-xl font-bold text-foreground">Admin access required</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            AI usage dashboards are only available to accounts with admin permission.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to={PATHS.dashboard}
              className="inline-flex min-h-10 items-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  return children;
}
