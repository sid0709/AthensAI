/**
 * worker_threads entry — owns Chromium + PDF render + optional base64 encode.
 * Keeps heavy CPU/IO off the Athens-server API event loop.
 */

import { parentPort, workerData } from "node:worker_threads";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

if (!process.env.PUPPETEER_CACHE_DIR) {
	process.env.PUPPETEER_CACHE_DIR = join(
		dirname(fileURLToPath(import.meta.url)),
		"../../../.cache/puppeteer",
	);
}

function envInt(name, fallback) {
	const n = Number.parseInt(String(process.env[name] ?? ""), 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

const BROWSER_POOL_SIZE = envInt(
	"PUPPETEER_BROWSER_POOL",
	Number(workerData?.browserPoolSize) || 6,
);

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
  .resume-print-body { width: 100%; }
</style>
</head>
<body>
  <div class="resume-print-body">${html}</div>
</body>
</html>`;
}

async function renderPdf(opts) {
	const body = typeof opts?.html === "string" ? opts.html : "";
	if (!body.trim()) throw new Error("html is required");
	const doc = buildHtmlDocument({
		html: body,
		paper: opts.paper === "a4" ? "a4" : "letter",
		marginInches: opts.marginInches,
		font: opts.font,
		baseSizePt: opts.baseSizePt,
		fontLinks: opts.fontLinks,
	});
	const browser = await getBrowser();
	const page = await browser.newPage();
	try {
		await page.setContent(doc, { waitUntil: "domcontentloaded", timeout: 30000 });
		await page.evaluate(async () => {
			if (document.fonts && document.fonts.ready) await document.fonts.ready;
		});
		const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
		return Buffer.from(pdf);
	} finally {
		await page.close().catch(() => {});
	}
}

async function closeBrowsers() {
	for (let i = 0; i < browserSlotPromises.length; i += 1) {
		const p = browserSlotPromises[i];
		browserSlotPromises[i] = null;
		if (!p) continue;
		try {
			const b = await p;
			await b.close();
		} catch {
			/* ignore */
		}
	}
}

parentPort.on("message", async (msg) => {
	if (!msg || typeof msg !== "object") return;
	const { id, type, payload } = msg;

	if (type === "shutdown") {
		await closeBrowsers();
		parentPort.postMessage({ id, ok: true });
		return;
	}

	try {
		if (type === "encode") {
			const raw = payload?.buffer;
			const buffer = Buffer.isBuffer(raw)
				? raw
				: raw instanceof ArrayBuffer
					? Buffer.from(raw)
					: Buffer.from(raw || []);
			parentPort.postMessage({
				id,
				ok: true,
				base64: buffer.toString("base64"),
				byteLength: buffer.length,
			});
			return;
		}

		if (type !== "render") {
			parentPort.postMessage({ id, ok: false, error: `Unknown type: ${type}` });
			return;
		}

		const buffer = await renderPdf(payload || {});
		const asBase64 = Boolean(payload?.asBase64);
		if (asBase64) {
			parentPort.postMessage({
				id,
				ok: true,
				base64: buffer.toString("base64"),
				byteLength: buffer.length,
			});
			return;
		}
		const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
		parentPort.postMessage({ id, ok: true, buffer: ab, byteLength: buffer.length }, [ab]);
	} catch (err) {
		parentPort.postMessage({
			id,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		});
	}
});
