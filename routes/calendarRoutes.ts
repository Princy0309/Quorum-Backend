import { Router } from 'express';
import {
  createCalendarEventController,
  getCalendarEventsByMonthController,
  getCalendarEventsByDateController,
  getUpcomingCalendarEventsController,
  getCalendarEventByIdController,
  updateCalendarEventController,
  deleteCalendarEventController,
} from '../controllers/calendarController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import {
  createCalendarEventSchema,
  updateCalendarEventSchema,
  monthQuerySchema,
  dateQuerySchema,
} from '../validators/calendarValidators.js';

const router = Router();

router.use(authMiddleware);

router.post('/', validate(createCalendarEventSchema), createCalendarEventController);
router.get('/month', validate(monthQuerySchema), getCalendarEventsByMonthController);
router.get('/date', validate(dateQuerySchema), getCalendarEventsByDateController);
router.get('/upcoming', getUpcomingCalendarEventsController);
router.get('/:id', getCalendarEventByIdController);
router.patch('/:id', validate(updateCalendarEventSchema), updateCalendarEventController);
router.delete('/:id', deleteCalendarEventController);

export default router;
