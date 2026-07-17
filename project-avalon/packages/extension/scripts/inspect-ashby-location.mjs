import { chromium } from 'playwright';

const URL = 'https://jobs.ashbyhq.com/tapcart/279d1b05-06fe-4348-afda-8d4d72982579/application?utm_source=jobright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(4000);

const info = await page.evaluate(() => {
  const combos = [...document.querySelectorAll('[role="combobox"]')];
  return combos.map((el) => ({
    tag: el.tagName,
    id: el.id,
    ariaControls: el.getAttribute('aria-controls'),
    ariaLabelledby: el.getAttribute('aria-labelledby'),
    className: (el.className || '').toString().slice(0, 100),
    parentClasses: el.parentElement?.className?.toString().slice(0, 100),
    fieldHtml: el.closest('.ashby-application-form-field-entry')?.innerHTML.slice(0, 300),
  }));
});
console.log('comboboxes', JSON.stringify(info, null, 2));

const loc = page.locator('[role="combobox"]').first();
await loc.click();
await page.keyboard.type('New York');
await page.waitForTimeout(1500);

const afterType = await page.evaluate(() => {
  const input = document.querySelector('[role="combobox"]');
  const cid = input?.getAttribute('aria-controls');
  const lb = cid ? document.getElementById(cid) : document.querySelector('[role="listbox"]');
  return {
    ariaControls: cid,
    ariaExpanded: input?.getAttribute('aria-expanded'),
    options: lb ? [...lb.querySelectorAll('[role="option"]')].slice(0, 5).map((o) => o.textContent?.trim()) : [],
    listboxId: lb?.id,
  };
});
console.log('after type', JSON.stringify(afterType, null, 2));

await browser.close();
