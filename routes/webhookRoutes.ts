import { Router } from 'express';
import { handleJiraWebhookController } from '../controllers/jiraWebhookController.js';

const router = Router();

router.post('/jira', handleJiraWebhookController);

export default router;
