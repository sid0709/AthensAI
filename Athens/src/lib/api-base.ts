function trimTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

function isLoopbackUrl(raw: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    return u.hostname === "127.0.0.1" || u.hostname === "localhost";
  } catch {
    return false;
  }
}

function normalizeConfiguredApiBase(raw: string): string {
  if (!/^https?:\/\//i.test(raw)) {
    return trimTrailingSlashes(raw) || "/api";
  }
  const u = new URL(raw);
  const path = trimTrailingSlashes(u.pathname) || "/";
  if (path === "/" || path === "") {
    u.pathname = "/api";
  }
  return trimTrailingSlashes(u.toString());
}

/**
 * REST base including `/api` suffix.
 * - `SERVER_API_URL` / `VITE_API_URL`: full URL to Athens-server, e.g. `http://127.0.0.1:8979/api`
 * - Dev: loopback URLs are proxied via same-origin `/api` so LAN clients work (see vite.config.ts)
 */
export function resolveApiBase(): string {
  const server = import.meta.env.SERVER_API_URL?.trim();
  const vite = import.meta.env.VITE_API_URL?.trim();
  const raw = server || vite;
  if (
    import.meta.env.DEV &&
    (!raw || isLoopbackUrl(raw) || import.meta.env.VITE_DEV_RELATIVE_API === "1")
  ) {
    return "/api";
  }
  if (raw) {
    return normalizeConfiguredApiBase(raw);
  }
  return "/api";
}

/** In dev, route loopback service URLs through the Vite proxy prefix. */
export function resolveDevServiceUrl(
  envValue: string | undefined,
  proxyPrefix: string,
  fallback: string,
): string {
  const configured = envValue?.trim() || fallback;
  if (import.meta.env.DEV && isLoopbackUrl(configured)) {
    return proxyPrefix;
  }
  return trimTrailingSlashes(configured);
}

export const API_BASE = resolveApiBase();
