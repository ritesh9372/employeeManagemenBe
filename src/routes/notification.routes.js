import express from 'express';
import { authMiddleware } from '../middleware/authmiddleware.js';
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead } from '../controllers/notification.controller.js';

const router = express.Router();

router.get('/', authMiddleware, getNotifications);
router.get('/unread-count', authMiddleware, getUnreadCount);

router.put('/read-all', authMiddleware, markAllAsRead);
router.patch('/read-all', authMiddleware, markAllAsRead);

router.put('/:id/read', authMiddleware, markAsRead);
router.patch('/:id/read', authMiddleware, markAsRead);

export default router;
