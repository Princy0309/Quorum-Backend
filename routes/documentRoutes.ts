import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import {
  createDocumentSchema,
  updateDocumentSchema,
  addCollaboratorSchema,
  openDocumentInMeetingSchema,
  embedWhiteboardInDocSchema,
  documentAiPromptSchema,
} from '../validators/documentValidators.js';
import {
  createDocumentController,
  listUserDocumentsController,
  getDocumentByIdController,
  updateDocumentController,
  deleteDocumentController,
  addCollaboratorController,
  removeCollaboratorController,
  openDocumentInMeetingController,
  embedWhiteboardInDocController,
  executeDocumentAiController,
} from '../controllers/documentController.js';

const router = Router();

router.post('/', authMiddleware, validate(createDocumentSchema), createDocumentController);
router.get('/', authMiddleware, listUserDocumentsController);
router.get('/:id', authMiddleware, getDocumentByIdController);
router.patch('/:id', authMiddleware, validate(updateDocumentSchema), updateDocumentController);
router.delete('/:id', authMiddleware, deleteDocumentController);

router.post('/:id/collaborators', authMiddleware, validate(addCollaboratorSchema), addCollaboratorController);
router.delete('/:id/collaborators/:userId', authMiddleware, removeCollaboratorController);

router.post('/:id/open-in-meeting', authMiddleware, validate(openDocumentInMeetingSchema), openDocumentInMeetingController);
router.post('/:id/whiteboards', authMiddleware, validate(embedWhiteboardInDocSchema), embedWhiteboardInDocController);
router.post('/:id/ai', authMiddleware, validate(documentAiPromptSchema), executeDocumentAiController);

export default router;
