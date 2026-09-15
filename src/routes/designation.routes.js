import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import { getDesignations, getDesignation, createDesignation, updateDesignation, deleteDesignation, toggleDesignationStatus } from '../controllers/designation.controller.js';

const router = express.Router();

router.get('/', authMiddleware, getDesignations);
router.get('/:id', authMiddleware, getDesignation);
router.post('/', authMiddleware, roleMiddleware('admin', 'hr'), createDesignation);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'hr'), updateDesignation);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), deleteDesignation);
router.patch('/:id/toggle-status', authMiddleware, roleMiddleware('admin', 'hr'), toggleDesignationStatus);

export default router;
