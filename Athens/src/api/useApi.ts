import { useCallback, useState } from "react";
import { API_BASE } from "@/lib/api-base";

type ApiError = Error & { status?: number; data?: unknown };

export function useApi(baseUrl: string = API_BASE) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const request = useCallback(
    async (path: string, options: RequestInit & { body?: unknown } = {}) => {
      setLoading(true);
      setError(null);
      try {
        const rel = path.replace(/^\//, "");
        const url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/${rel}` : path;
        const baseHeaders: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
        const method = (options.method || "GET").toUpperCase();
        const bodyForFetch =
          options.body !== undefined && options.body !== null && typeof options.body !== "string"
            ? JSON.stringify(options.body)
            : (options.body as string | undefined);
        const headers: Record<string, string> = { ...baseHeaders };
        if (bodyForFetch !== undefined && bodyForFetch !== "") {
          headers["Content-Type"] = headers["Content-Type"] || "application/json";
        }
        const res = await fetch(url, {
          ...options,
          method,
          headers,
          body: bodyForFetch,
        });
        const text = await res.text();
        const ct = res.headers.get("content-type") || "";
        const looksJson = ct.includes("application/json") || (text.length > 0 && (text[0] === "{" || text[0] === "["));
        let data: unknown = text;
        if (text && looksJson) {
          try {
            data = JSON.parse(text);
          } catch {
            data = { parseError: true, rawSnippet: text.slice(0, 120) };
          }
        } else if (!text) {
          data = null;
        }
        if (!res.ok) {
          const err = new Error("Request failed") as ApiError;
          err.status = res.status;
          err.data = data;
          throw err;
        }
        setLoading(false);
        return data;
      } catch (err) {
        setError(err as Error);
        setLoading(false);
        throw err;
      }
    },
    [baseUrl],
  );

  const get = useCallback((path: string) => request(path, { method: "GET" }), [request]);
  const post = useCallback((path: string, body?: unknown) => request(path, { method: "POST", body }), [request]);
  const put = useCallback((path: string, body?: unknown) => request(path, { method: "PUT", body }), [request]);
  const del = useCallback((path: string, body?: unknown) => request(path, { method: "DELETE", body }), [request]);

  return { loading, error, get, post, put, del, request };
}
