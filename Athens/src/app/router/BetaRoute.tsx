import type { ReactNode } from "react";
import { Crown, Loader2, LockKeyhole } from "lucide-react";
import { Link } from "react-router";
import { useApplier } from "@/context/applier-context";
import { PATHS } from "../config/routes";
import { PageShell } from "../components/layout/PageShell";
import { isBetaTier } from "../lib/beta";

export function BetaRoute({ children }: { children: ReactNode }) {
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

  if (!isBetaTier(applier?.tier)) {
    return (
      <PageShell>
        <div className="mx-auto mt-10 max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-amber-50 text-amber-700 ring-1 ring-amber-200">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-amber-700">
            <Crown className="h-3.5 w-3.5" />
            Beta
          </div>
          <h1 className="text-xl font-bold text-foreground">Beta workspace required</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This page is available for Beta accounts. Your current workspace still has access to job search,
            resumes, agents, mail, and settings.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to={PATHS.settings}
              className="inline-flex min-h-10 items-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90"
            >
              View profile
            </Link>
            <Link
              to={PATHS.dashboard}
              className="inline-flex min-h-10 items-center rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-bold text-foreground hover:bg-muted"
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
