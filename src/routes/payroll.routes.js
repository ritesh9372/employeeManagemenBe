import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import { getPayrolls, getPayroll, createPayroll, updatePayroll, processPayroll, markAsPaid, deletePayroll } from '../controllers/payroll.controller.js';

const router = express.Router();

router.get('/', authMiddleware, getPayrolls);
router.get('/:id', authMiddleware, getPayroll);
router.post('/', authMiddleware, roleMiddleware('admin', 'hr'), createPayroll);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'hr'), updatePayroll);
router.patch('/:id/process', authMiddleware, roleMiddleware('admin', 'hr'), processPayroll);
router.patch('/:id/paid', authMiddleware, roleMiddleware('admin', 'hr'), markAsPaid);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'hr'), deletePayroll);

export default router;
