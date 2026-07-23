import { findAccountByApplierName } from '../services/mail/credentials.js';
import { isBetaTier } from '../lib/betaTier.js';
import {
	getTitleScanSessionStatus,
	startTitleScanSession,
	stopTitleScanSession,
} from '../services/jobTitleScan/titleScanSession.js';

/** Title scan is Beta-only — resolve applier from Mongo tier, never trust client flags. */
async function requireBetaApplierName(applierNameRaw, res) {
	const applierName = String(applierNameRaw || '').trim();
	if (!applierName) {
		res.status(400).json({
			success: false,
			error: 'applierName is required.',
			betaRequired: true,
		});
		return null;
	}
	const acc = await findAccountByApplierName(applierName);
	if (!acc) {
		res.status(404).json({ success: false, error: `No account named "${applierName}".` });
		return null;
	}
	if (!isBetaTier(acc.tier)) {
		res.status(403).json({
			success: false,
			error: 'Beta workspace required.',
			betaRequired: true,
		});
		return null;
	}
	return applierName;
}

export async function getTitleScanStatus(req, res) {
	try {
		const applierName = await requireBetaApplierName(
			req.query?.applierName || req.body?.applierName,
			res,
		);
		if (!applierName) return;
		const status = await getTitleScanSessionStatus(applierName);
		return res.json({ success: true, ...status });
	} catch (err) {
		console.error('GET /api/jobs/title-scan/status error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function startTitleScan(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.body?.applierName, res);
		if (!applierName) return;
		const limit = req.body?.limit;
		const result = await startTitleScanSession({ applierName, limit });
		return res.status(result.started ? 202 : 200).json({ success: true, ...result });
	} catch (err) {
		const status = err.message.includes('already running') ? 409 : 400;
		console.error('POST /api/jobs/title-scan/start error', err);
		return res.status(status).json({ success: false, error: err.message });
	}
}

export async function stopTitleScan(req, res) {
	try {
		const applierName = await requireBetaApplierName(
			req.body?.applierName || req.query?.applierName,
			res,
		);
		if (!applierName) return;
		const result = stopTitleScanSession();
		return res.json({ success: true, ...result });
	} catch (err) {
		console.error('POST /api/jobs/title-scan/stop error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}
