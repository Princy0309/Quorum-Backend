import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import {
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema
} from '../validators/chatValidators.js';
import {
  registerDeviceController,
  unregisterDeviceController
} from '../controllers/deviceController.js';

const router = Router();

router.post('/', authMiddleware, validate(registerDeviceTokenSchema), registerDeviceController);
router.delete('/', authMiddleware, validate(unregisterDeviceTokenSchema), unregisterDeviceController);

export default router;
