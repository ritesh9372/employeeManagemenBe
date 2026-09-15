import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import { getAnnouncements, getAllAnnouncements, getAnnouncement, createAnnouncement, updateAnnouncement, deleteAnnouncement } from '../controllers/announcement.controller.js';

const router = express.Router();

router.get('/all', authMiddleware, roleMiddleware('admin', 'hr'), getAllAnnouncements);
router.get('/', authMiddleware, getAnnouncements);
router.get('/:id', authMiddleware, getAnnouncement);
router.post('/', authMiddleware, roleMiddleware('admin', 'hr'), createAnnouncement);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'hr'), updateAnnouncement);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'hr'), deleteAnnouncement);

export default router;
