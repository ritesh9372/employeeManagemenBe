import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import { getTasks, getTask, createTask, updateTask, deleteTask, getTaskStats } from '../controllers/task.controller.js';

const router = express.Router();

router.get('/stats', authMiddleware, getTaskStats);
router.get('/', authMiddleware, getTasks);
router.get('/:id', authMiddleware, getTask);
router.post('/', authMiddleware, roleMiddleware('admin', 'hr', 'manager'), createTask);
router.put('/:id', authMiddleware, updateTask);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'hr', 'manager'), deleteTask);

export default router;
