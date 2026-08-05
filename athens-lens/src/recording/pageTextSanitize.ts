/**
 * Manatal (and similar) inject large <style> sheets into open shadow roots.
 * Reading style.innerText returns the full CSS — strip that noise before Ask AI.
 */
export function stripStylesheetNoise(text: string): string {
  const source = String(text || "");
  if (!source) return "";

  const cutCandidates: number[] = [];
  const patterns = [
    /\n:host\s*\{/,
    /\n:root\s*\{/,
    /:host\s*\{--/,
    /\n@tailwind\b/,
    /\n@import\b/,
    /\n\/\*!?\s*tailwind/i,
    /\n--tw-border-spacing-x\s*:/,
    /\n--color-[a-z0-9-]+\s*:\s*#/,
  ];
  for (const pattern of patterns) {
    const index = source.search(pattern);
    if (index >= 0) cutCandidates.push(index);
  }

  const cutAt = cutCandidates.length ? Math.min(...cutCandidates) : -1;
  return (cutAt >= 0 ? source.slice(0, cutAt) : source)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
