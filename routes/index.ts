import { Router, Request, Response } from 'express';
import authRoutes from './authRoutes.js';
import otpRoutes from './otpRoutes.js';
import userRoutes from './userRoutes.js';
import meetingRoutes from './meetingRoutes.js';
import organizationRoutes from './organizationRoutes.js';
import communityRoutes from './communityRoutes.js';
import postRoutes from './postRoutes.js';
import commentRoutes from './commentRoutes.js';
import dmRoutes from './dmRoutes.js';
import conversationRoutes from './conversationRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import deviceRoutes from './deviceRoutes.js';
import aiRoutes from './aiRoutes.js';
import notificationRoutes from './notificationRoutes.js';


const router = Router();

router.get('/csrf-token', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({ csrfToken: res.locals.csrfToken || req.cookies['XSRF-TOKEN'] });
});

router.use('/auth', authRoutes);
router.use('/otp', otpRoutes);
router.use('/user', userRoutes);
router.use('/users', userRoutes);
router.use('/chat/users', userRoutes);
router.use('/v1/users', userRoutes);
router.use('/v1/chat/users', userRoutes);

router.use('/notifications', notificationRoutes);
router.use('/notification', notificationRoutes);
router.use('/v1/notifications', notificationRoutes);
router.use('/ai', aiRoutes);
router.use('/v1/ai', aiRoutes);

router.use('/meetings', meetingRoutes);
router.use('/organizations', organizationRoutes);

router.use('/communities', communityRoutes);
router.use('/community', communityRoutes);
router.use('/v1/communities', communityRoutes);
router.use('/v1/community', communityRoutes);

router.use('/community-posts', postRoutes);
router.use('/posts', postRoutes);
router.use('/v1/posts', postRoutes);
router.use('/v1/community-posts', postRoutes);
router.use('/feed', postRoutes);

router.use('/community-comments', commentRoutes);
router.use('/comments', commentRoutes);
router.use('/v1/comments', commentRoutes);
router.use('/v1/community-comments', commentRoutes);

router.use('/dm', dmRoutes);
router.use('/conversations', conversationRoutes);
router.use('/chat/conversations', conversationRoutes);
router.use('/v1/conversations', conversationRoutes);
router.use('/v1/chat/conversations', conversationRoutes);

router.use('/uploads', uploadRoutes);
router.use('/devices', deviceRoutes);


export default router;
