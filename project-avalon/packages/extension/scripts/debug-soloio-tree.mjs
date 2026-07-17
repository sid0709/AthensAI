import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL =
  'https://job-boards.greenhouse.io/embed/job_app?for=soloioinc&token=4696734005&utm_source=jobright';

await esbuild.build({
  entryPoints: [join(__dirname, '../src/utils/actionable-tree.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'AvalonActionable',
  outfile: join(__dirname, 'actionable-tree.bundle.js'),
  platform: 'browser',
  logLevel: 'silent',
  footer: { js: 'globalThis.AvalonActionable = AvalonActionable;' },
});
const bundle = readFileSync(join(__dirname, 'actionable-tree.bundle.js'), 'utf8');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(5000);

const result = await page.evaluate(async (code) => {
  eval(code);
  const tree = await globalThis.AvalonActionable.fetchActionableTree(document.body, {
    probeComboboxes: true,
    probeTimeoutMs: 2500,
  });
  return tree.map((g, i) => ({
    i,
    contentLen: g.content.length,
    contentStart: g.content.slice(0, 100),
    children: g.children.map((c) => ({ target: c.target, type: c.controlType })),
  }));
}, bundle);

console.log(JSON.stringify(result, null, 2));
const giant = result.filter((g) => g.contentLen > 500);
console.log('\nGIANT GROUPS:', giant.length);
for (const g of giant) {
  console.log(`group ${g.i}: len=${g.contentLen}, children=${JSON.stringify(g.children)}`);
  console.log(g.contentStart + '...');
}

await browser.close();
