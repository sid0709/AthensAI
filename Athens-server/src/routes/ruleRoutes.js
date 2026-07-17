import express from 'express';
import { getRules, createRule, deleteRule, updateRule } from '../controllers/ruleController.js';

const router = express.Router();

router.get('/rules', getRules);
router.post('/rules', createRule);
router.put('/rules/:name', updateRule);
router.delete('/rules/:name', deleteRule);

export default router;
