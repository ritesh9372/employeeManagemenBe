import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import {
  getDepartmentPolicies, getDepartmentPolicy, createDepartmentPolicy,
  updateDepartmentPolicy, deactivateDepartmentPolicy
} from '../controllers/departmentPolicy.controller.js';

const router = express.Router();

router.get('/', authMiddleware, roleMiddleware('admin', 'hr'), getDepartmentPolicies);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'hr'), getDepartmentPolicy);
router.post('/', authMiddleware, roleMiddleware('admin', 'hr'), createDepartmentPolicy);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'hr'), updateDepartmentPolicy);
router.patch('/:id/deactivate', authMiddleware, roleMiddleware('admin', 'hr'), deactivateDepartmentPolicy);

export default router;
