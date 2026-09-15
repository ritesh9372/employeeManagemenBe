import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import { getDepartments, getDepartment, createDepartment, updateDepartment, deleteDepartment, toggleDepartmentStatus } from '../controllers/department.controller.js';

const router = express.Router();

router.get('/', authMiddleware, getDepartments);
router.get('/:id', authMiddleware, getDepartment);
router.post('/', authMiddleware, roleMiddleware('admin', 'hr'), createDepartment);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'hr'), updateDepartment);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), deleteDepartment);
router.patch('/:id/toggle-status', authMiddleware, roleMiddleware('admin', 'hr'), toggleDepartmentStatus);

export default router;
