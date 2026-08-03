import { TOKEN_RE } from "../constants/tokens";

export function resolvePromptTokens(text: string, tokenValues: Record<string, string>): string {
  return String(text ?? "").replace(TOKEN_RE, (match) => {
    const key = match.slice(1, -1).toLowerCase();
    return Object.prototype.hasOwnProperty.call(tokenValues, key) ? tokenValues[key] : match;
  });
}
