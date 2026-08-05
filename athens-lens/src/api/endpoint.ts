const KEY = "athens-ext-cfg-v1";

function bytesFromBase64(body: string): Uint8Array {
  if (typeof atob === "function") {
    return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  }
  // wxt.config.ts runs in Node during pack/build.
  const { Buffer } = globalThis as typeof globalThis & {
    Buffer?: { from(data: string, encoding: string): Uint8Array };
  };
  if (!Buffer) throw new Error("Base64 decode unavailable");
  return Uint8Array.from(Buffer.from(body, "base64"));
}

/** Decode XOR+base64 endpoint tokens produced by docker/encode-endpoint.py. */
export function decodeEndpoint(token: string): string {
  const normalized = token.trim();
  if (!normalized) return "";
  // Support plain URLs in local .env for easy debugging.
  if (/^https?:\/\//i.test(normalized)) return normalized;
  const body = normalized.startsWith("enc:") ? normalized.slice(4) : normalized;
  const raw = bytesFromBase64(body);
  let out = "";
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
