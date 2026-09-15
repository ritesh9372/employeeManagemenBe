import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import {
  getLeaveTypes, getLeaveBalance, getAllLeaveBalances, allocateSingleLeaveBalance,
  allocateBulkLeaveBalance, getLeaves, getLeave, applyLeave, approveLeave,
  rejectLeave, cancelLeave
} from '../controllers/leave.controller.js';

const router = express.Router();

router.get('/types', authMiddleware, getLeaveTypes);
router.get('/balance', authMiddleware, getLeaveBalance);
router.get('/balances/my', authMiddleware, getLeaveBalance);
router.get('/balances', authMiddleware, getAllLeaveBalances);
router.post('/balances/single', authMiddleware, roleMiddleware('admin', 'hr'), allocateSingleLeaveBalance);
router.post('/balances/bulk', authMiddleware, roleMiddleware('admin', 'hr'), allocateBulkLeaveBalance);


router.get('/', authMiddleware, getLeaves);
router.get('/:id', authMiddleware, getLeave);
router.post('/', authMiddleware, applyLeave);
router.put('/:id/approve', authMiddleware, roleMiddleware('admin', 'hr', 'manager'), approveLeave);
router.put('/:id/reject', authMiddleware, roleMiddleware('admin', 'hr', 'manager'), rejectLeave);
router.put('/:id/cancel', authMiddleware, cancelLeave);

export default router;
