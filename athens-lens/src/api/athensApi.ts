const DEFAULT_API_BASE_URL = "http://127.0.0.1:8979/api";

export const ATHENS_API_BASE_URL = String(
  import.meta.env.WXT_ATHENS_API_URL || DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

interface ApiErrorPayload {
  code?: string;
  error?: string;
  message?: string;
}

export class AthensApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AthensApiError";
    this.status = status;
    this.code = code || null;
  }
}

interface ApiRequestOptions extends RequestInit {
  accessToken?: string;
}

export async function requestAthensApi<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { accessToken, headers: inputHeaders, ...requestOptions } = options;
  const headers = new Headers(inputHeaders);
  headers.set("Accept", "application/json");
  if (requestOptions.body) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  let response: Response;
  try {
    response = await fetch(`${ATHENS_API_BASE_URL}${path}`, {
      ...requestOptions,
      headers
    });
  } catch {
    throw new AthensApiError("Athens server could not be reached.", 0, "NETWORK_ERROR");
  }

  const payload = await response.json().catch(() => null) as (T & ApiErrorPayload) | null;
  if (!response.ok) {
    throw new AthensApiError(
      payload?.message || payload?.error || "Athens server returned an error.",
      response.status,
      payload?.code
    );
  }
  if (!payload) throw new AthensApiError("Athens server returned an invalid response.", response.status);
  return payload;
}
