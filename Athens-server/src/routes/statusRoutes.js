import { Router } from 'express';
import { overallStatus, readCurrentStatus, readDailyRollups, readIncidents, readLiveMetrics } from '../services/monitoring/statusStore.js';

const router = Router();
router.get('/status/current', async (_req, res, next) => {
	try {
		const components = await readCurrentStatus();
		const timestamps = components.map((component) => component.lastCheckedAt ? new Date(component.lastCheckedAt).getTime() : 0);
		const latest = Math.max(...timestamps);
		res.set('Cache-Control', 'no-store');
		res.json({ ok: true, service: 'athensai', status: overallStatus(components), updatedAt: latest > 0 ? new Date(latest).toISOString() : null, components });
	}
	catch (error) { next(error); }
});
router.get('/status/history', async (req, res, next) => {
	try { const days = Math.min(Math.max(Number(req.query.days || 90), 1), 90); const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); res.set('Cache-Control', 'public, max-age=60'); res.json({ ok: true, days, rollups: await readDailyRollups(from, String(req.query.to || '')) }); }
	catch (error) { next(error); }
});
router.get('/status/incidents', async (_req, res, next) => {
	try { res.set('Cache-Control', 'public, max-age=60'); res.json({ ok: true, incidents: await readIncidents() }); }
	catch (error) { next(error); }
});
router.get('/status/live', async (req, res, next) => {
	try {
		const minutes = Number(req.query.minutes || 60);
		if (![15, 60, 360, 1440].includes(minutes)) return res.status(400).json({ ok: false, error: 'Unsupported live metrics range.' });
		const points = await readLiveMetrics(minutes);
		res.set('Cache-Control', 'no-store');
		const current = points.at(-1) || null;
		return res.json({ ok: true, minutes, updatedAt: current?.timestamp || null, current, points });
	} catch (error) { return next(error); }
});
export default router;
