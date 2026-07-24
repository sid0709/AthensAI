import { API_BASE } from "./api-base";
import { getFirebaseIdToken } from "./firebase-client";

let installed = false;

function configuredOrigins(): string[] {
  return [API_BASE, import.meta.env.VITE_AI_BFF_URL, import.meta.env.VITE_AVALON_SERVER]
    .map((value) => String(value || "").trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function isProtectedRequest(input: RequestInfo | URL): boolean {
  const raw = input instanceof Request ? input.url : String(input);
  if (raw.startsWith("/api") || raw.startsWith("/personal") || raw.startsWith("/avalon")) return true;
  return configuredOrigins().some((base) => raw === base || raw.startsWith(`${base}/`));
}

/** Install once so existing API modules receive fresh Firebase tokens without
 * duplicating auth code across every fetch call. */
export function installAuthenticatedFetch() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!isProtectedRequest(input)) return nativeFetch(input, init);
    const token = await getFirebaseIdToken();
    if (!token) return nativeFetch(input, init);
    const sourceHeaders = input instanceof Request ? input.headers : undefined;
    const headers = new Headers(sourceHeaders);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    return nativeFetch(input, { ...init, headers });
  };
}
