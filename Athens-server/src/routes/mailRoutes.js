import express from 'express';
import {
	getMailThreads,
	getMailMessage,
	syncMail,
	syncMailInitial,
	syncMailOlder,
	sendMailMessage,
	patchMailMessage,
	getMailLabels,
	postMailLabel,
	deleteMailLabel,
	putMailLabels,
	checkMailCredentials,
	getMailFolderCounts,
	getVerificationCode,
	getMailLabelDefinitions,
	putMailLabelDefinitions,
	postMailAiLabel,
	postMailAiWrite,
} from '../controllers/mailController.js';

const router = express.Router();

router.get('/mail/threads', getMailThreads);
router.get('/mail/messages/:uid', getMailMessage);
router.get('/mail/credentials', checkMailCredentials);
router.get('/mail/folder-counts', getMailFolderCounts);
router.post('/mail/sync', syncMail);
router.post('/mail/verification-code', getVerificationCode);
router.post('/mail/sync/initial', syncMailInitial);
router.post('/mail/sync/older', syncMailOlder);
router.post('/mail/send', sendMailMessage);
router.patch('/mail/messages/:uid', patchMailMessage);
router.get('/mail/labels', getMailLabels);
router.get('/mail/label-definitions', getMailLabelDefinitions);
router.put('/mail/label-definitions', putMailLabelDefinitions);
router.post('/mail/ai-label', postMailAiLabel);
router.post('/mail/ai-write', postMailAiWrite);
router.post('/mail/labels', postMailLabel);
router.delete('/mail/labels/:labelId', deleteMailLabel);
router.put('/mail/labels', putMailLabels);

export default router;
