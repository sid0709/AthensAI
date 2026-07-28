export interface JobPageContext {
  title: string;
  company: string;
  description: string;
  visibleText: string;
  structured: boolean;
  page: { url: string; title: string };
}

/** Serialized into the tab by browser.scripting; keep all helpers inside the function. */
export function readJobContextFromPage(): JobPageContext {
  const clean = (value: unknown, limit = 80_000) =>
    String(value ?? '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  const meta = (selector: string) => clean(document.querySelector<HTMLMetaElement>(selector)?.content, 2_000);
  const candidates: Record<string, unknown>[] = [];
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent || 'null');
      const visit = (value: unknown) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        const row = value as Record<string, unknown>;
        const types = Array.isArray(row['@type']) ? row['@type'] : [row['@type']];
        if (types.some((type) => String(type).toLowerCase() === 'jobposting')) candidates.push(row);
        if (Array.isArray(row['@graph'])) row['@graph'].forEach(visit);
      };
      visit(parsed);
    } catch {
      // Ignore malformed third-party JSON-LD and continue with fallbacks.
    }
  }
  const posting = candidates[0];
  const organization = posting?.hiringOrganization;
  const company = clean(
    typeof organization === 'object' && organization
      ? (organization as Record<string, unknown>).name
      : organization || meta('meta[property="og:site_name"]'),
    300,
  );
  const title = clean(
    posting?.title || meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title,
    300,
  );
  const description = clean(
    posting?.description || meta('meta[name="description"]') || meta('meta[property="og:description"]'),
  );
  const textParts: string[] = [];
  let textLength = 0;
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current && textLength < 120_000) {
    const parent = current.parentElement;
    if (parent && !parent.closest('input,textarea,select,option,[contenteditable="true"],script,style,noscript,iframe,object,embed')) {
      const style = window.getComputedStyle(parent);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        const value = clean(current.nodeValue, 120_000 - textLength);
        if (value) {
          textParts.push(value);
          textLength += value.length + 1;
        }
      }
    }
    current = walker.nextNode();
  }
  const fullText = clean(textParts.join(' '), 120_000);
  const visibleText = fullText.length <= 30_000
    ? fullText
    : `${fullText.slice(0, 15_000)} … ${fullText.slice(-15_000)}`;
  return {
    title,
    company,
    description,
    visibleText,
    structured: Boolean(posting),
    page: { url: location.href, title: clean(document.title, 300) },
  };
}
