import express from 'express';
import { getEmployees } from '../controllers/employecontroller.js';
import { authMiddleware } from '../middleware/authmiddleware.js';

const router = express.Router();

router.get(
    '/',
    authMiddleware,
    getEmployees
);

export default router;