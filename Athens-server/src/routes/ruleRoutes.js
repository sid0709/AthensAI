import express from 'express';
import { getRules, createRule, deleteRule, updateRule } from '../controllers/ruleController.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = express.Router();

router.get('/rules', getRules);
router.post('/rules', requireAdmin, createRule);
router.put('/rules/:name', requireAdmin, updateRule);
router.delete('/rules/:name', requireAdmin, deleteRule);

export default router;
