import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import { getHolidays, getHoliday, createHoliday, updateHoliday, deleteHoliday } from '../controllers/holiday.controller.js';

const router = express.Router();

router.get('/', authMiddleware, getHolidays);
router.get('/:id', authMiddleware, getHoliday);
router.post('/', authMiddleware, roleMiddleware('admin', 'hr'), createHoliday);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'hr'), updateHoliday);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'hr'), deleteHoliday);

export default router;
