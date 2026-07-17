/**
 * Debug Ashby file-input attach behavior (local Playwright probe).
 * Usage: node scripts/debug-ashby-file-attach.mjs [url]
 */
import { chromium } from 'playwright';

const url =
  process.argv[2] ||
  'https://jobs.ashbyhq.com/forma/b52609ac-6e33-4072-84bb-0c27a10488bf/application?utm_source=jobright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const inputs = await page.evaluate(() => {
    return [...document.querySelectorAll('input[type=file]')].map((inp, i) => ({
      i,
      id: inp.id,
      accept: inp.accept?.slice(0, 60),
      visible: Boolean(inp.offsetParent),
    }));
  });
  console.log('file inputs:', inputs);

  // Small synthetic PDF
  const tinyPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF',
    'utf8',
  );

  const attachResult = await page.evaluate(async (b64) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'test-resume.pdf', { type: 'application/pdf' });
    const results = [];
    for (const inp of document.querySelectorAll('input[type=file]')) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        inp.files = dt.files;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        results.push({ id: inp.id, files: inp.files.length, name: inp.files[0]?.name });
      } catch (e) {
        results.push({ id: inp.id, error: String(e) });
      }
    }
    return results;
  }, tinyPdf.toString('base64'));

  console.log('attachResult (tiny PDF):', attachResult);

  // Playwright setInputFiles API (what real automation uses)
  const resumeInput = page.locator('input#_systemfield_resume');
  const count = await resumeInput.count();
  console.log('resume input count:', count);
  if (count) {
    await resumeInput.setInputFiles({
      name: 'test-resume.pdf',
      mimeType: 'application/pdf',
      buffer: tinyPdf,
    });
    const after = await page.evaluate(() => {
      const inp = document.querySelector('input#_systemfield_resume');
      return { files: inp?.files?.length, name: inp?.files?.[0]?.name };
    });
    console.log('after setInputFiles:', after);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
