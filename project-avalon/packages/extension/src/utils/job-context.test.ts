import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readJobContextFromPage } from './job-context.js';

function withPage(html: string, run: () => void) {
  const dom = new JSDOM(html, { url: 'https://jobs.example.com/role' });
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const key of ['window', 'document', 'location', 'Node', 'NodeFilter'] as const) {
    globals[key] = dom.window[key] as unknown;
  }
  try {
    run();
  } finally {
    dom.window.close();
  }
}

withPage(`<!doctype html><title>Fallback title</title><body>
  <script type="application/ld+json">{
    "@context":"https://schema.org","@type":"JobPosting","title":"Senior Engineer",
    "hiringOrganization":{"@type":"Organization","name":"Acme"},
    "description":"<p>Build reliable systems.</p>"
  }</script>
  <main>Public job details</main>
</body>`, () => {
  const context = readJobContextFromPage();
  assert.equal(context.structured, true);
  assert.equal(context.title, 'Senior Engineer');
  assert.equal(context.company, 'Acme');
  assert.equal(context.description, 'Build reliable systems.');
});

withPage(`<!doctype html><head>
  <meta property="og:title" content="Product Engineer">
  <meta property="og:site_name" content="Example Co">
  <meta name="description" content="Own the product end to end.">
</head><body><main>Fallback visible role text</main></body>`, () => {
  const context = readJobContextFromPage();
  assert.equal(context.structured, false);
  assert.equal(context.title, 'Product Engineer');
  assert.equal(context.company, 'Example Co');
  assert.equal(context.description, 'Own the product end to end.');
});

withPage(`<!doctype html><title>Plain job</title><body>
  <main>${'A'.repeat(18_000)} public requirements ${'Z'.repeat(18_000)}</main>
  <input value="private input value"><input type="password" value="hunter2">
  <textarea>private textarea value</textarea><div contenteditable="true">private editor value</div>
</body>`, () => {
  const context = readJobContextFromPage();
  assert.ok(context.visibleText.length <= 30_003);
  assert.match(context.visibleText, /^A+/);
  assert.match(context.visibleText, /Z+$/);
  assert.equal(context.visibleText.includes('private input value'), false);
  assert.equal(context.visibleText.includes('hunter2'), false);
  assert.equal(context.visibleText.includes('private textarea value'), false);
  assert.equal(context.visibleText.includes('private editor value'), false);
});

console.log('job-context tests passed');
