import express from 'express';
import {
	cancelTask,
	createTask,
	getTask,
	listTasks,
	streamTaskEvents,
} from '../controllers/backgroundTaskController.js';

const router = express.Router();

router.get('/background-tasks/events', streamTaskEvents);
router.get('/background-tasks', listTasks);
router.post('/background-tasks', createTask);
router.get('/background-tasks/:taskId', getTask);
router.post('/background-tasks/:taskId/cancel', cancelTask);

export default router;
