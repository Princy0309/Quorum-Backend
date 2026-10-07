import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  registerDeviceController,
  unregisterDeviceController
} from '../controllers/deviceController.js';

const router = Router();

router.post('/', authMiddleware, registerDeviceController);
router.delete('/', authMiddleware, unregisterDeviceController);

export default router;
