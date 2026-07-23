import { ObjectId } from 'mongodb';
import { Router } from 'express';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getMongoDb } from '../db/mongo.js';
import { getComponentDefinitions } from '../services/monitoring/statusStore.js';

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
		const db = getMongoDb();
		if (!db) return res.status(503).json({ error: 'Database not ready' });
		const now = new Date();
		const incident = { component, name: definition.name, status: allowedStates.has(req.body?.status) ? req.body.status : 'investigating', severity: text(req.body?.severity, 30) || 'warning', title, description, startedAt: now, resolvedAt: null, updates: [{ status: 'investigating', message: description, createdAt: now }] };
		const result = await db.collection('monitor_incidents').insertOne(incident);
		res.status(201).json({ ok: true, incident: { ...incident, id: String(result.insertedId) } });
	} catch (error) { next(error); }
});

router.patch('/status/incidents/:id', requireAdmin, async (req, res, next) => {
	try {
		if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid incident id' });
		const db = getMongoDb();
		if (!db) return res.status(503).json({ error: 'Database not ready' });
		const status = allowedStates.has(req.body?.status) ? req.body.status : null;
		const message = text(req.body?.message, 1000);
		if (!status && !message) return res.status(400).json({ error: 'status or message is required' });
		const set = {};
		if (status) set.status = status;
		if (status === 'resolved') set.resolvedAt = new Date();
		const push = status || message ? { updates: { status: status || undefined, message: message || undefined, createdAt: new Date() } } : null;
		const result = await db.collection('monitor_incidents').findOneAndUpdate({ _id: new ObjectId(req.params.id) }, { $set: set, ...(push ? { $push: push } : {}) }, { returnDocument: 'after', projection: { _id: 0, internalReason: 0 } });
		if (!result) return res.status(404).json({ error: 'Incident not found' });
		res.json({ ok: true, incident: result });
	} catch (error) { next(error); }
});

export default router;
