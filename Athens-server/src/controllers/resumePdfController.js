import { renderPdfInWorker } from "../services/pdf/pdfRenderPool.js";

/**
 * Server-side resume PDF rendering.
 *
 * The frontend sends the already-rendered, inline-styled resume DOM (the inner
 * HTML of the live preview's `.resume-page`). We render it with headless Chromium
 * in true paged mode via a worker_threads pool — so Chromium + PDF encode never
 * block the Athens-server API / Socket.IO event loop.
 *
 * Browser pool size stays high (PUPPETEER_BROWSER_POOL, default 6) and
 * PDF_RENDER_CONCURRENCY stays high (default 16) — isolation, not throttling.
 */

/**
 * Render résumé body HTML to a PDF Buffer with the SAME paged Chromium pipeline the Profile
 * page uses (so server-generated agent résumés match the preview output).
 *
 * @param {object} opts
 * @param {string} opts.html
 * @param {string} [opts.paper]
 * @param {number} [opts.marginInches]
 * @param {string} [opts.font]
 * @param {number} [opts.baseSizePt]
 * @param {string[]} [opts.fontLinks]
 * @param {boolean} [opts.asBase64] — when true, returns base64 string (encoded off the main thread)
 * @returns {Promise<Buffer|string>}
 */
export async function htmlToPdf({
	html,
	paper = "letter",
	marginInches,
	font,
	baseSizePt,
	fontLinks,
	asBase64 = false,
} = {}) {
	const body = typeof html === "string" ? html : "";
	if (!body.trim()) throw new Error("html is required");
	const result = await renderPdfInWorker({
		html: body,
		paper: paper === "a4" ? "a4" : "letter",
		marginInches,
		font,
		baseSizePt,
		fontLinks,
		asBase64,
	});
	if (asBase64) return result.base64;
	return result.buffer;
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
