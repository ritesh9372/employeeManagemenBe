import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import { upload } from '../middleware/upload.js';
import { getManagers } from '../controllers/authcontroller.js';
import {
  getEmployees, getEmployee, getEmployeeProfile,
  createEmployee, updateEmployee, deleteEmployee,
  toggleEmployeeStatus, uploadProfilePhoto
} from '../controllers/employee.controller.js';

const router = express.Router();

router.get('/profile', authMiddleware, getEmployeeProfile);
router.get('/managers', authMiddleware, getManagers);
router.get('/', authMiddleware, roleMiddleware('admin', 'hr', 'manager'), getEmployees);
router.get('/:id', authMiddleware, getEmployee);
router.post('/', authMiddleware, roleMiddleware('admin', 'hr'), createEmployee);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'hr'), updateEmployee);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), deleteEmployee);
router.patch('/:id/toggle-status', authMiddleware, roleMiddleware('admin', 'hr'), toggleEmployeeStatus);
router.post('/:id/photo', authMiddleware, roleMiddleware('admin', 'hr'), upload.single('photo'), uploadProfilePhoto);

export default router;
