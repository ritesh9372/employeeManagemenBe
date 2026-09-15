import express from 'express';
import { authMiddleware } from '../middleware/authmiddleware.js';
import { getMe, updateProfile, changePassword } from '../controllers/profile.controller.js';

const router = express.Router();

router.get('/me', authMiddleware, getMe);
router.put('/me', authMiddleware, updateProfile);
router.put('/me/password', authMiddleware, changePassword);

export default router;
