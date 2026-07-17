import { chromium } from 'playwright';

const URLS = [
  'https://job-boards.greenhouse.io/embed/job_app?for=phdata&token=7776052&utm_source=jobright',
  'https://jobs.ashbyhq.com/tapcart/279d1b05-06fe-4348-afda-8d4d72982579/application?utm_source=jobright',
];

async function inspectPage(page, url) {
  console.log('\n===', url, '===');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const summary = await page.evaluate(() => {
    const combos = [...document.querySelectorAll('input[role="combobox"], [role="combobox"], [aria-haspopup="listbox"]')];
    const selects = [...document.querySelectorAll('select')];
    const buttons = [...document.querySelectorAll('button[aria-haspopup], button[aria-expanded]')];

    function accName(el) {
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      const fromIds = ids.map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
      if (fromIds) return fromIds;
      return el.getAttribute('aria-label') || '';
    }

    return {
      comboboxes: combos.slice(0, 15).map((el) => ({
        tag: el.tagName,
        id: el.id,
        role: el.getAttribute('role'),
        type: el.getAttribute('type'),
        ariaExpanded: el.getAttribute('aria-expanded'),
        ariaControls: el.getAttribute('aria-controls'),
        ariaHaspopup: el.getAttribute('aria-haspopup'),
        accessibleName: accName(el),
        placeholder: el.getAttribute('placeholder'),
        className: (el.className || '').toString().slice(0, 80),
        listboxOptions: (() => {
          const cid = el.getAttribute('aria-controls');
          const lb = cid ? document.getElementById(cid) : el.closest('[class*="select"]')?.querySelector('[role="listbox"]');
          return lb ? lb.querySelectorAll('[role="option"]').length : 0;
        })(),
      })),
      nativeSelects: selects.length,
      popupButtons: buttons.slice(0, 10).map((el) => ({
        text: (el.textContent || '').trim().slice(0, 40),
        ariaExpanded: el.getAttribute('aria-expanded'),
        ariaHaspopup: el.getAttribute('aria-haspopup'),
        className: (el.className || '').toString().slice(0, 60),
      })),
      ashbyFields: [...document.querySelectorAll('[data-testid], [class*="ashby"], [class*="Select"]')].slice(0, 5).map((el) => ({
        tag: el.tagName,
        testId: el.getAttribute('data-testid'),
        className: (el.className || '').toString().slice(0, 80),
      })),
    };
  });

  console.log(JSON.stringify(summary, null, 2));

  // Try probing first combobox on page
  const probeResult = await page.evaluate(async () => {
    const input = document.querySelector('input[role="combobox"]');
    if (!input) return { found: false };

    const toggle = input.closest('[class*="control"]')?.querySelector('button');
    if (toggle) toggle.click();
    await new Promise((r) => setTimeout(r, 500));

    const cid = input.getAttribute('aria-controls');
    const listbox = cid ? document.getElementById(cid) : document.querySelector('[role="listbox"]');
    const options = listbox ? [...listbox.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim()) : [];

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (toggle) toggle.click();

    return {
      found: true,
      id: input.id,
      expanded: input.getAttribute('aria-expanded'),
      optionsCount: options.length,
      options: options.slice(0, 5),
    };
  });

  console.log('probe:', JSON.stringify(probeResult, null, 2));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
for (const url of URLS) {
  try {
    await inspectPage(page, url);
  } catch (error) {
    console.error('failed', url, error.message);
  }
}
await browser.close();
