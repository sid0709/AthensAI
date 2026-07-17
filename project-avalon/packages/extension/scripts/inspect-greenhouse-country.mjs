import { chromium } from 'playwright';

const URL = 'https://job-boards.greenhouse.io/embed/job_app?for=phdata&token=7776052&utm_source=jobright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(4000);

const info = await page.evaluate(() => {
  const combos = [...document.querySelectorAll('input[role="combobox"]')].map((el) => ({
    id: el.id,
    labelledBy: el.getAttribute('aria-labelledby'),
    label: (() => {
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/);
      return ids.map((id) => document.getElementById(id)?.textContent?.trim()).join(' ');
    })(),
    inIti: !!el.closest('.iti'),
    inPhone: !!el.closest('.phone-input, fieldset.phone-input'),
    inSelect: !!el.closest('.select__container'),
    ariaControls: el.getAttribute('aria-controls'),
  }));
  return combos;
});
console.log(JSON.stringify(info, null, 2));

await browser.close();
