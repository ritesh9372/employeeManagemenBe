import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/authmiddleware.js';
import { getReviews, getReview, createReview, updateReview, deleteReview } from '../controllers/performance.controller.js';

const router = express.Router();

router.get('/', authMiddleware, getReviews);
router.get('/:id', authMiddleware, getReview);
router.post('/', authMiddleware, roleMiddleware('admin', 'hr', 'manager'), createReview);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'hr', 'manager'), updateReview);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'hr', 'manager'), deleteReview);

export default router;
