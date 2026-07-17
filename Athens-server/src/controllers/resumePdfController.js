import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { pdfRenderLimiter } from "../utils/concurrency.js";

/**
 * Server-side resume PDF rendering.
 *
 * The frontend sends the already-rendered, inline-styled resume DOM (the inner
 * HTML of the live preview's `.resume-page`). We render it with headless Chromium
 * in true paged mode — content flows naturally and every page gets the same
 * margin via `@page` — so the output matches the preview without the broken
 * pagination, missing top margins, and blank pages that `window.print()` produced.
 *
 * Rendering from the preview's own DOM means no template logic is re-implemented
 * here, so nothing is lost in translation.
 *
 * Uses Puppeteer's bundled Chrome for Testing (installed via postinstall /
 * `npm run install:chrome`). Do not depend on a host Chrome install — servers
 * and containers often have none. Optional override: PUPPETEER_EXECUTABLE_PATH.
 *
 * Browser pool: PUPPETEER_BROWSER_POOL (default 6) launches multiple Chromium
 * processes so bulk PDF refresh can saturate CPU alongside PDF_RENDER_CONCURRENCY.
 */

// Prefer a project-local cache so deploys don't rely on ~/.cache or system Chrome.
if (!process.env.PUPPETEER_CACHE_DIR) {
	process.env.PUPPETEER_CACHE_DIR = join(
		dirname(fileURLToPath(import.meta.url)),
		"../../.cache/puppeteer",
	);
}

function envInt(name, fallback) {
	const n = Number.parseInt(String(process.env[name] ?? ""), 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

const BROWSER_POOL_SIZE = envInt("PUPPETEER_BROWSER_POOL", 6);

/** @type {(Promise<import('puppeteer').Browser> | null)[]} */
const browserSlotPromises = Array.from({ length: BROWSER_POOL_SIZE }, () => null);
let rr = 0;

function launchOpts() {
	const opts = {
		headless: "new",
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--font-render-hinting=none",
			"--disable-dev-shm-usage",
			"--disable-gpu",
		],
	};
	if (process.env.PUPPETEER_EXECUTABLE_PATH) {
		opts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
	}
	return opts;
}

/** Round-robin browser from the pool; relaunch a slot if Chromium died. */
async function getBrowser() {
	const slot = rr % BROWSER_POOL_SIZE;
	rr += 1;
	const existing = browserSlotPromises[slot];
	if (existing) {
		const b = await existing.catch(() => null);
		if (b && b.connected) return b;
		browserSlotPromises[slot] = null;
	}
	browserSlotPromises[slot] = puppeteer.launch(launchOpts());
	return browserSlotPromises[slot];
}

function escapeAttr(value) {
	return String(value).replace(/[<>"]/g, "");
}

const PAPER = { letter: "Letter", a4: "A4" };

function buildHtmlDocument({ html, paper, marginInches, font, baseSizePt, fontLinks }) {
	const size = PAPER[paper] || "Letter";
	const margin = Number.isFinite(marginInches) && marginInches >= 0 ? marginInches : 0.5;
	const base = Number.isFinite(baseSizePt) && baseSizePt > 0 ? baseSizePt : 10.5;
	const fontFamily = font ? String(font) : "Georgia, 'Times New Roman', serif";
	const links = Array.isArray(fontLinks)
		? fontLinks
				.filter((h) => typeof h === "string" && /^https?:\/\//.test(h))
				.map((h) => `<link rel="stylesheet" href="${escapeAttr(h)}">`)
				.join("\n")
		: "";

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
${links}
<style>
  @page { size: ${size}; margin: ${margin}in; }
  html, body { margin: 0; padding: 0; background: #fff; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: ${fontFamily};
    font-size: ${base}pt;
    line-height: 1.42;
    color: #111827;
  }
  /* The preview wraps content in a fixed-size, clipped page box; in paged mode we
     let it flow full-width and rely on @page for margins. */
  .resume-print-body { width: 100%; }
</style>
</head>
<body>
  <div class="resume-print-body">${html}</div>
</body>
</html>`;
}

/**
 * Render résumé body HTML to a PDF Buffer with the SAME paged Chromium pipeline the Profile
 * page uses (so server-generated agent résumés match the preview output). Reusable by the
 * route handler and the agent résumé service.
 */
export async function htmlToPdf({ html, paper = "letter", marginInches, font, baseSizePt, fontLinks } = {}) {
	const body = typeof html === "string" ? html : "";
	if (!body.trim()) throw new Error("html is required");
	const doc = buildHtmlDocument({
		html: body,
		paper: paper === "a4" ? "a4" : "letter",
		marginInches,
		font,
		baseSizePt,
		fontLinks,
	});
	return pdfRenderLimiter.run(async () => {
		const browser = await getBrowser();
		const page = await browser.newPage();
		try {
			// domcontentloaded is much faster than networkidle0 for bulk refresh;
			// fonts.ready still waits for webfonts when linked.
			await page.setContent(doc, { waitUntil: "domcontentloaded", timeout: 30000 });
			await page.evaluate(async () => {
				if (document.fonts && document.fonts.ready) await document.fonts.ready;
			});
			return await page.pdf({ printBackground: true, preferCSSPageSize: true });
		} finally {
			await page.close().catch(() => {});
		}
	});
}

/** POST /personal/resume-pdf — render the preview DOM to a downloadable PDF. */
export async function renderResumePdf(req, res) {
	try {
		const body = req.body || {};
		const pdf = await htmlToPdf({
			html: typeof body.html === "string" ? body.html : "",
			paper: body.paper === "a4" ? "a4" : "letter",
			marginInches: Number(body.marginInches),
			font: body.font,
			baseSizePt: Number(body.baseSizePt),
			fontLinks: body.fontLinks,
		});
		const rawName = String(body.fileName || "resume.pdf").replace(/[^\w.\- ]+/g, "_");
		const fileName = rawName.toLowerCase().endsWith(".pdf") ? rawName : `${rawName}.pdf`;
		res.setHeader("Content-Type", "application/pdf");
		res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
		res.setHeader("Content-Length", pdf.length);
		return res.end(pdf);
	} catch (err) {
		console.error("POST /api/personal/resume-pdf failed:", err.message);
		return res.status(err.message === "html is required" ? 400 : 500).json({ success: false, error: err.message });
	}
}
