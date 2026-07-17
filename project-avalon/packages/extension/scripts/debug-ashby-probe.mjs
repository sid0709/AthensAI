import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(__dirname, 'actionable-tree.bundle.js');
const URL =
  'https://jobs.ashbyhq.com/tapcart/279d1b05-06fe-4348-afda-8d4d72982579/application?utm_source=jobright';

await esbuild.build({
  entryPoints: [join(__dirname, '../src/utils/actionable-tree.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'AvalonActionable',
  outfile: bundlePath,
  platform: 'browser',
  logLevel: 'silent',
  footer: { js: 'globalThis.AvalonActionable = AvalonActionable;' },
});
const bundle = readFileSync(bundlePath, 'utf8');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(6000);

const debug = await page.evaluate(async (code) => {
  eval(code);
  const input = document.querySelector('[role="combobox"]');
  if (!input) return { error: 'no combobox' };

  const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  nativeSet?.call(input, 'New York');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'New York' }));

  await new Promise((r) => setTimeout(r, 1500));

  const cid = input.getAttribute('aria-controls');
  const lb = cid ? document.getElementById(cid) : null;
  return {
    id: input.id,
    value: input.value,
    ariaControls: cid,
    ariaExpanded: input.getAttribute('aria-expanded'),
    listboxFound: !!lb,
    options: lb ? [...lb.querySelectorAll('[role="option"]')].slice(0, 5).map((o) => o.textContent?.trim()) : [],
  };
}, bundle);
console.log('programmatic:', debug);

const trusted = await page.evaluate(() => {
  const input = document.querySelector('[role="combobox"]');
  return { tag: input?.tagName, id: input?.id, className: input?.className };
});
console.log('combobox meta:', trusted);

await page.locator('[role="combobox"]').first().click();
await page.keyboard.type('New York');
await page.waitForTimeout(1500);

const afterTrusted = await page.evaluate(() => {
  const input = document.querySelector('[role="combobox"]');
  const cid = input?.getAttribute('aria-controls');
  const lb = cid ? document.getElementById(cid) : null;
  return {
    value: input?.value,
    ariaControls: cid,
    options: lb ? [...lb.querySelectorAll('[role="option"]')].slice(0, 5).map((o) => o.textContent?.trim()) : [],
  };
});
console.log('trusted:', afterTrusted);

await browser.close();
