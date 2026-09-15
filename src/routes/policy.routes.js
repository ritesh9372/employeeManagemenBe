import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import {
  getPolicies, getPolicy, createPolicy, updatePolicy, deletePolicy,
  previewPolicy, syncAllBalancesEndpoint, getEmployeeCurrentPolicy
} from '../controllers/policy.controller.js';

const router = express.Router();

router.get('/', authMiddleware, roleMiddleware('admin', 'hr'), getPolicies);
router.get('/current-policy/:employeeId', authMiddleware, roleMiddleware('admin', 'hr'), getEmployeeCurrentPolicy);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'hr'), getPolicy);
router.post('/', authMiddleware, roleMiddleware('admin', 'hr'), createPolicy);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'hr'), updatePolicy);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'hr'), deletePolicy);
router.post('/preview', authMiddleware, roleMiddleware('admin', 'hr'), previewPolicy);
router.post('/sync-all', authMiddleware, roleMiddleware('admin', 'hr'), syncAllBalancesEndpoint);

export default router;

