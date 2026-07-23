import { Router } from 'express';
import { overallStatus, readCurrentStatus, readDailyRollups, readIncidents } from '../services/monitoring/statusStore.js';

const router = Router();
router.get('/status/current', async (_req, res, next) => {
	try { const components = await readCurrentStatus(); res.set('Cache-Control', 'no-store'); res.json({ ok: true, service: 'athensai', status: overallStatus(components), updatedAt: new Date().toISOString(), components }); }
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
export default router;
