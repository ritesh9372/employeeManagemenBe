import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import { getEmployeeReport, getAttendanceReport, getLeaveReport, getPayrollReport } from '../controllers/report.controller.js';

const router = express.Router();

router.get('/employees', authMiddleware, roleMiddleware('admin', 'hr'), getEmployeeReport);
router.get('/attendance', authMiddleware, roleMiddleware('admin', 'hr'), getAttendanceReport);
router.get('/leaves', authMiddleware, roleMiddleware('admin', 'hr'), getLeaveReport);
router.get('/payroll', authMiddleware, roleMiddleware('admin', 'hr'), getPayrollReport);

export default router;
