const PLACEHOLDER_PATTERNS = [
  /^sk-\.{2,}$/i,
  /^sk-\.+$/i,
  /your[_-]?key/i,
  /changeme/i,
  /replace[_-]?me/i,
  /^xxx+$/i,
  /^<.*>$/,
];

/** True when the key looks like a real credential, not a .env.example placeholder. */
export function isValidApiKey(key: string | undefined): key is string {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length < 12) return false;
  if (trimmed.includes('...')) return false;
  return !PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function normalizeApiKey(key: string | undefined): string | undefined {
  return isValidApiKey(key) ? key.trim() : undefined;
}
