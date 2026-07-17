/**
 * Page context extract + merge — same approach as bid-assistant:
 * chrome.scripting.executeScript({ allFrames: true }) → body.innerText per frame
 * → merge ATS iframes (Greenhouse, iCIMS, etc.).
 * No character / field caps.
 */
const PageContext = (() => {
  /** Injected via chrome.scripting.executeScript — must be self-contained. */
  function extractPageContext() {
    const getMetaDescription = () => {
      const meta = document.querySelector('meta[name="description"]');
      return meta?.getAttribute('content')?.trim() ?? '';
    };

    const getFieldLabel = (element) => {
      const id = element.getAttribute('id');
      if (id) {
        try {
          const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (label?.textContent?.trim()) return label.textContent.trim();
        } catch {
          /* ignore */
        }
      }
      const ariaLabel = element.getAttribute('aria-label')?.trim();
      if (ariaLabel) return ariaLabel;
      const parentLabel = element.closest('label');
      if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labelEl = document.getElementById(labelledBy);
        if (labelEl?.textContent?.trim()) return labelEl.textContent.trim();
      }
      return '';
    };

    /** Lightweight form hints only — AI answers primarily from page innerText. */
    const extractFormFields = () => {
      const fields = [];
      const elements = document.querySelectorAll('input, textarea, select');
      for (const element of elements) {
        const type =
          element.tagName === 'SELECT'
            ? 'select'
            : element.tagName === 'TEXTAREA'
              ? 'textarea'
              : (element.type || 'text').toLowerCase();
        if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') {
          continue;
        }
        const options = [];
        if (element.tagName === 'SELECT') {
          for (const option of element.options) {
            const text = option.textContent?.trim();
            if (text) options.push(text);
          }
        }
        const label = getFieldLabel(element);
        const placeholder = element.placeholder?.trim?.() ?? '';
        const name = element.getAttribute('name')?.trim() ?? '';
        if (!label && !placeholder && !name && options.length === 0) continue;
        fields.push({
          label,
          name,
          type,
          placeholder,
          options,
          required: Boolean(element.required),
        });
      }
      return fields;
    };

    const visibleText = (document.body?.innerText ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      url: location.href,
      title: document.title.trim(),
      metaDescription: getMetaDescription(),
      visibleText,
      forms: extractFormFields(),
      frameUrl: location.href,
    };
  }

  function formFieldKey(field) {
    return `${field.type}|${field.name}|${field.label}|${field.placeholder}`.toLowerCase();
  }

  function isUsefulFrame(ctx) {
    const url = (ctx.frameUrl || ctx.url || '').toLowerCase();
    if (url.startsWith('about:blank') || url.startsWith('javascript:')) {
      return (ctx.forms?.length ?? 0) > 0;
    }
    return (ctx.visibleText?.length ?? 0) >= 40 || (ctx.forms?.length ?? 0) > 0;
  }

  /**
   * Merge per-frame results so ATS pages that host the form in an iframe
   * (Greenhouse, iCIMS, Workday, …) still yield full context.
   */
  function mergePageContexts(frames, topLevel) {
    const useful = frames.filter((frame) => frame && isUsefulFrame(frame));
    if (useful.length === 0) return null;

    const scoreFrame = (ctx) => {
      const url = (ctx.frameUrl || ctx.url || '').toLowerCase();
      let boost = 0;
      if (
        /icims\.com|greenhouse\.io|lever\.co|myworkdayjobs|ashbyhq\.com|jobvite|smartrecruiters/.test(
          url,
        )
      ) {
        boost += 2000;
      }
      if (/\/job|\/jobs|\/application|\/apply/.test(url)) boost += 500;
      return (ctx.visibleText?.length || 0) + boost;
    };

    const ranked = [...useful].sort((a, b) => scoreFrame(b) - scoreFrame(a));
    const primary = ranked[0];
    const textParts = [];
    for (const frame of ranked) {
      const text = (frame.visibleText || '').trim();
      if (!text) continue;
      if (textParts.some((part) => part.includes(text))) continue;
      textParts.push(text);
    }

    const seenForms = new Set();
    const forms = [];
    for (const frame of ranked) {
      for (const field of frame.forms ?? []) {
        const key = formFieldKey(field);
        if (seenForms.has(key)) continue;
        seenForms.add(key);
        forms.push(field);
      }
    }

    const topUrl = topLevel?.url?.trim() || '';
    const topTitle = topLevel?.title?.trim() || '';
    const visibleText = textParts.join('\n\n');
    const frameUrls = ranked
      .map((f) => f.frameUrl || f.url)
      .filter((u, i, arr) => Boolean(u) && arr.indexOf(u) === i);

    return {
      url: topUrl || primary.url,
      title: topTitle || primary.title,
      metaDescription:
        primary.metaDescription ||
        ranked.find((f) => f.metaDescription)?.metaDescription ||
        '',
      visibleText,
      forms,
      frameUrl: primary.frameUrl || primary.url,
      sourceMeta: {
        charCount: visibleText.length,
        formCount: forms.length,
        frameCount: useful.length,
        frameUrls,
        primaryFrameUrl: primary.frameUrl || primary.url || null,
      },
    };
  }

  async function extractFromTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    // allFrames: true — same as bid-assistant; form often lives in an iframe.
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: extractPageContext,
    });
    const frames = (results || []).map((r) => r.result).filter(Boolean);
    return mergePageContexts(frames, { url: tab.url, title: tab.title });
  }

  return { extractFromTab, mergePageContexts, extractPageContext };
})();
