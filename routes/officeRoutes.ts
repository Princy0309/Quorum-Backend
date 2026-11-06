import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  getOfficeFloorController,
  joinOfficeController,
  knockOnDeskController,
  claimDeskController,
  changeOfficeZoneController,
  leaveOfficeController,
} from '../controllers/officeController.js';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get(['/:teamId', '/'], getOfficeFloorController);
router.post(['/:teamId/join', '/join'], joinOfficeController);
router.post(['/:teamId/knock', '/knock'], knockOnDeskController);
router.post(['/:teamId/desk/claim', '/desk/claim'], claimDeskController);
router.post(['/:teamId/zone', '/zone'], changeOfficeZoneController);
router.post(['/:teamId/leave', '/leave'], leaveOfficeController);

export default router;
