import { Router } from 'express';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { createManualIncident, getComponentDefinitions, updateManualIncident } from '../services/monitoring/statusStore.js';

const router = Router();
const allowedStates = new Set(['detected', 'investigating', 'identified', 'monitoring', 'resolved']);

function text(value, max) {
	const result = String(value ?? '').trim();
	return result ? result.slice(0, max) : '';
}

router.post('/status/incidents', requireAdmin, async (req, res, next) => {
	try {
		const component = text(req.body?.component, 80);
		const definition = getComponentDefinitions().find((item) => item.id === component);
		const title = text(req.body?.title, 160);
		const description = text(req.body?.description, 1000);
		if (!definition || !title || !description) return res.status(400).json({ error: 'component, title, and description are required' });
		const incident = await createManualIncident({
			component,
			status: allowedStates.has(req.body?.status) ? req.body.status : 'investigating',
			severity: text(req.body?.severity, 30) || 'warning',
			title,
			description,
		});
		return res.status(201).json({ ok: true, incident });
	} catch (error) { return next(error); }
});

router.patch('/status/incidents/:id', requireAdmin, async (req, res, next) => {
	try {
		const id = text(req.params.id, 180);
		if (!id || id.includes('/')) return res.status(400).json({ error: 'Invalid incident id' });
		const status = allowedStates.has(req.body?.status) ? req.body.status : null;
		const message = text(req.body?.message, 1000);
		if (!status && !message) return res.status(400).json({ error: 'status or message is required' });
		const incident = await updateManualIncident(id, { status, message });
		if (!incident) return res.status(404).json({ error: 'Incident not found' });
		return res.json({ ok: true, incident });
	} catch (error) { return next(error); }
});

export default router;
