import { db } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';

export async function getNotifications(req, res) {
  try {
    const { unread_only } = req.query;
    let where = 'user_id = ?';
    const params = [req.user.id];
    if (unread_only === 'true') { where += ' AND is_read = 0'; }

    const [rows] = await db.query(
      `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT 50`, params
    );
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch notifications');
  }
}

export async function getUnreadCount(req, res) {
  try {
    const [[{ count }]] = await db.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]
    );
    return successResponse(res, { count });
  } catch (err) {
    return errorResponse(res, 'Failed to get unread count');
  }
}

export async function markAsRead(req, res) {
  try {
    await db.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    return successResponse(res, null, 'Notification marked as read');
  } catch (err) {
    return errorResponse(res, 'Failed to update notification');
  }
}

export async function markAllAsRead(req, res) {
  try {
    await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    return successResponse(res, null, 'All notifications marked as read');
  } catch (err) {
    return errorResponse(res, 'Failed to update notifications');
  }
}
