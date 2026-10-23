import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  saveItemController,
  getSavedItemsController,
  updateSavedItemController,
  removeSavedItemController,
  createCollectionController,
  getCollectionsController,
  updateCollectionController,
  deleteCollectionController
} from '../controllers/savedItemController.js';

const router = Router();

router.use(authMiddleware);

router.post('/collections', createCollectionController);
router.get('/collections', getCollectionsController);
router.patch('/collections/:id', updateCollectionController);
router.delete('/collections/:id', deleteCollectionController);

router.post('/', saveItemController);
router.get('/', getSavedItemsController);
router.patch('/:id', updateSavedItemController);
router.delete('/:id', removeSavedItemController);

export default router;
