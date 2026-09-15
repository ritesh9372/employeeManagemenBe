import express from 'express';
import { register, login, getManagers } from '../controllers/authcontroller.js';
import { authMiddleware } from '../middleware/authmiddleware.js';
import { getMe } from '../controllers/profile.controller.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', authMiddleware, getMe);
router.get('/managers', authMiddleware, getManagers);

export default router;