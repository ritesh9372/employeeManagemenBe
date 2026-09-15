import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import { getAdminDashboard, getHRDashboard, getManagerDashboard, getEmployeeDashboard } from '../controllers/dashboard.controller.js';

const router = express.Router();

router.get('/admin', authMiddleware, roleMiddleware('admin'), getAdminDashboard);
router.get('/hr', authMiddleware, roleMiddleware('admin', 'hr'), getHRDashboard);
router.get('/manager', authMiddleware, roleMiddleware('admin', 'hr', 'manager'), getManagerDashboard);
router.get('/employee', authMiddleware, getEmployeeDashboard);

export default router;
