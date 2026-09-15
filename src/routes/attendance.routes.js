import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import { checkIn, checkOut, getTodayAttendance, getAttendance, getEmployeeAttendance, updateAttendance } from '../controllers/attendance.controller.js';

const router = express.Router();

router.post('/check-in', authMiddleware, checkIn);
router.post('/check-out', authMiddleware, checkOut);
router.get('/today', authMiddleware, getTodayAttendance);
router.get('/employee/:id', authMiddleware, roleMiddleware('admin', 'hr', 'manager'), getEmployeeAttendance);
router.get('/', authMiddleware, getAttendance);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'hr'), updateAttendance);

export default router;
