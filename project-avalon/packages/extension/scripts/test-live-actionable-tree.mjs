import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(__dirname, 'actionable-tree.bundle.js');

const URLS = [
  {
    name: 'greenhouse-phdata',
    url: 'https://job-boards.greenhouse.io/embed/job_app?for=phdata&token=7776052&utm_source=jobright',
    expectComboboxes: ['Country', 'Location', 'Veteran Status'],
    rejectComboboxes: ['Phone'],
    minProbedOptions: 1,
    waitMs: 5000,
  },
  {
    name: 'ashby',
    url: 'https://jobs.ashbyhq.com/tapcart/279d1b05-06fe-4348-afda-8d4d72982579/application?utm_source=jobright',
    expectComboboxes: ['Location'],
    minProbedOptions: 1,
    waitMs: 8000,
  },
];

async function buildBundle() {
  mkdirSync(dirname(bundlePath), { recursive: true });
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
  return readFileSync(bundlePath, 'utf8');
}

function summarizeTree(tree) {
  return tree.flatMap((group) =>
    group.children.map((child) => ({
      target: child.target,
      controlType: child.controlType,
      optionsCount: child.options?.length ?? 0,
      optionsSource: child.optionsSource ?? null,
      sampleOptions: (child.options ?? []).slice(0, 4).map((o) => o.label),
      groupContent: group.content.slice(0, 120),
    })),
  );
}

async function testUrl(page, bundle, spec) {
  console.log(`\n=== ${spec.name}: ${spec.url} ===`);
  await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(spec.waitMs ?? 4000);
  await page.waitForSelector('input[aria-autocomplete="list"], input.select__input, .ashby-application-form-field-entry', {
    timeout: 30000,
  }).catch(() => {});

  const started = Date.now();
  const tree = await page.evaluate(
    async (code) => {
      // eslint-disable-next-line no-eval
      eval(code);
      return await globalThis.AvalonActionable.fetchActionableTree(document.body, {
        probeComboboxes: true,
        probeTimeoutMs: 600,
      });
    },
    bundle,
  );
  const elapsedMs = Date.now() - started;
  console.log(`fetchActionableTree: ${elapsedMs}ms`);

  const summary = summarizeTree(tree);
  const comboboxes = summary.filter((row) => row.controlType === 'combobox');
  console.log('comboboxes:', JSON.stringify(comboboxes, null, 2));

  const issues = [];

  for (const expected of spec.expectComboboxes) {
    const match = comboboxes.find((c) => c.target.toLowerCase().includes(expected.toLowerCase()));
    if (!match) {
      issues.push(`missing combobox: "${expected}"`);
      continue;
    }
    if (match.optionsCount === 0) {
      issues.push(`"${expected}" has no options`);
    }
    if (spec.minProbedOptions && match.optionsCount < spec.minProbedOptions) {
      issues.push(`"${expected}" expected >= ${spec.minProbedOptions} options, got ${match.optionsCount}`);
    }
  }

  for (const rejected of spec.rejectComboboxes ?? []) {
    if (comboboxes.some((c) => c.target.toLowerCase().includes(rejected.toLowerCase()))) {
      issues.push(`unexpected combobox still present: "${rejected}"`);
    }
  }

  for (const pattern of spec.rejectOptionPatterns ?? []) {
    for (const combo of comboboxes) {
      for (const label of combo.sampleOptions) {
        if (pattern.test(label)) {
          issues.push(`"${combo.target}" leaked phone country option: "${label}"`);
        }
      }
    }
  }

  if (issues.length) {
    console.error('FAIL:', issues.join('; '));
    return false;
  }

  console.log('PASS');
  return true;
}

const bundle = await buildBundle();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let passed = 0;
for (const spec of URLS) {
  try {
    if (await testUrl(page, bundle, spec)) passed += 1;
  } catch (error) {
    console.error(`ERROR on ${spec.name}:`, error.message);
  }
}

await browser.close();
console.log(`\n${passed}/${URLS.length} live tests passed`);
process.exit(passed === URLS.length ? 0 : 1);
