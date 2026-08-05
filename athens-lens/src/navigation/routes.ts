import { useCallback, useEffect, useState } from "react";

export type WorkspaceView = "jobs" | "inbox";

export interface WorkspaceRoute {
  view: WorkspaceView;
  itemId?: string;
}

export function parseWorkspaceRoute(hash: string): WorkspaceRoute {
  const [view, rawItemId] = hash.replace(/^#\/?/, "").split("/");
  const itemId = rawItemId ? decodeURIComponent(rawItemId) : undefined;

  if (view === "inbox") {
    return { view: "inbox", itemId };
  }

  return { view: "jobs", itemId };
}

export function formatWorkspaceRoute(route: WorkspaceRoute): string {
  return `#${route.view}${route.itemId ? `/${encodeURIComponent(route.itemId)}` : ""}`;
}

export function useWorkspaceRoute() {
  const [route, setRoute] = useState<WorkspaceRoute>(() => parseWorkspaceRoute(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => setRoute(parseWorkspaceRoute(window.location.hash));
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = useCallback((nextRoute: WorkspaceRoute) => {
    const nextHash = formatWorkspaceRoute(nextRoute);
    if (window.location.hash === nextHash) {
      setRoute(nextRoute);
    } else {
      window.location.hash = nextHash;
    }
  }, []);

  return { route, navigate };
}
