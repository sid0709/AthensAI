const KEY = 'athens-ext-cfg-v1';

/** Decode XOR+base64 endpoint tokens produced by docker/encode-endpoint.py. */
export function decodeEndpoint(token: string): string {
  const normalized = token.trim();
  if (!normalized) return '';
  // Support plain URLs in local .env for easy debugging.
  if (/^https?:\/\//i.test(normalized)) return normalized;
  const body = normalized.startsWith('enc:') ? normalized.slice(4) : normalized;
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw[i]! ^ KEY.charCodeAt(i % KEY.length));
  }
  return out;
}

export function resolveEndpoint(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  if (!v) return fallback;
  return decodeEndpoint(v) || fallback;
}

/**
 * Socket.IO origin for the Avalon relay.
 *
 * Accepts either a bare origin (`https://host:9030`) or the legacy VPS form
 * (`https://host:9030/avalon`). Socket.IO treats any URL path as a namespace, so
 * `/avalon` must never be passed to `io()` — that path belongs only on the
 * Engine.IO transport (`path: '/avalon/socket.io'`) and HTTP routes.
 */
export function relaySocketOrigin(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/avalon') {
      url.pathname = '/';
    }
    return url.origin;
  } catch {
    // Relative or malformed — strip a trailing /avalon heuristically.
    return trimmed.replace(/\/avalon$/i, '') || trimmed;
  }
}

/** HTTP base for `/avalon/health` and `/avalon/sessions` (always ends with `/avalon`). */
export function relayHttpBase(serverUrl: string): string {
  const origin = relaySocketOrigin(serverUrl);
  if (!origin) return '/avalon';
  return `${origin.replace(/\/+$/, '')}/avalon`;
}
