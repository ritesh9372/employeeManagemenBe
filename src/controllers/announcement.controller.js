import { db } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { createNotification } from '../utils/notification.js';

export async function getAnnouncements(req, res) {
  try {
    // Get user's employee info for dept-targeted announcements
    const [empRows] = await db.query('SELECT id, department_id FROM employees WHERE user_id = ?', [req.user.id]);
    const empId = empRows[0]?.id;
    const deptId = empRows[0]?.department_id;

    const [rows] = await db.query(
      `SELECT a.*, u.name as created_by_name
       FROM announcements a
       JOIN users u ON a.created_by = u.id
       WHERE (expiry_date IS NULL OR expiry_date >= CURDATE())
         AND (
           a.target = 'all'
           OR (a.target = 'department' AND a.target_id = ?)
           OR (a.target = 'employee' AND a.target_id = ?)
         )
       ORDER BY a.created_at DESC`,
      [deptId || -1, empId || -1]
    );
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch announcements');
  }
}

export async function getAllAnnouncements(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT a.*, u.name as created_by_name FROM announcements a JOIN users u ON a.created_by = u.id ORDER BY a.created_at DESC`
    );
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch announcements');
  }
}

export async function getAnnouncement(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT a.*, u.name as created_by_name FROM announcements a JOIN users u ON a.created_by = u.id WHERE a.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return errorResponse(res, 'Announcement not found', 404);
    return successResponse(res, rows[0]);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch announcement');
  }
}

export async function createAnnouncement(req, res) {
  try {
    const { title, description, publish_date, expiry_date, target, target_id } = req.body;
    if (!title || !description) return errorResponse(res, 'Title and description are required', 400);

    const [result] = await db.query(
      'INSERT INTO announcements (title, description, publish_date, expiry_date, target, target_id, created_by) VALUES (?,?,?,?,?,?,?)',
      [title, description, publish_date||null, expiry_date||null, target||'all', target_id||null, req.user.id]
    );

    // Notify targeted users
    let userIds = [];
    if (!target || target === 'all') {
      const [users] = await db.query('SELECT id FROM users WHERE is_active = 1');
      userIds = users.map(u => u.id);
    } else if (target === 'department') {
      const [users] = await db.query(
        'SELECT u.id FROM users u JOIN employees e ON u.id = e.user_id WHERE e.department_id = ? AND e.status = "active"',
        [target_id]
      );
      userIds = users.map(u => u.id);
    } else if (target === 'employee') {
      const [users] = await db.query('SELECT user_id FROM employees WHERE id = ?', [target_id]);
      if (users.length > 0 && users[0].user_id) userIds = [users[0].user_id];
    }

    for (const uid of userIds) {
      if (uid !== req.user.id) {
        await createNotification(uid, `Announcement: ${title}`, description.substring(0, 100), 'announcement', result.insertId);
      }
    }

    await logAudit(req.user.id, 'CREATE', 'announcements', result.insertId, `Created announcement "${title}"`, req.ip);
    return successResponse(res, { id: result.insertId }, 'Announcement created', 201);
  } catch (err) {
    return errorResponse(res, 'Failed to create announcement');
  }
}

export async function updateAnnouncement(req, res) {
  try {
    const { id } = req.params;
    const { title, description, publish_date, expiry_date, target, target_id } = req.body;

    const [existing] = await db.query('SELECT id FROM announcements WHERE id = ?', [id]);
    if (existing.length === 0) return errorResponse(res, 'Announcement not found', 404);

    await db.query(
      'UPDATE announcements SET title=?, description=?, publish_date=?, expiry_date=?, target=?, target_id=? WHERE id=?',
      [title, description, publish_date||null, expiry_date||null, target||'all', target_id||null, id]
    );
    return successResponse(res, null, 'Announcement updated');
  } catch (err) {
    return errorResponse(res, 'Failed to update announcement');
  }
}

export async function deleteAnnouncement(req, res) {
  try {
    const [rows] = await db.query('SELECT id FROM announcements WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return errorResponse(res, 'Announcement not found', 404);
    await db.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
    return successResponse(res, null, 'Announcement deleted');
  } catch (err) {
    return errorResponse(res, 'Failed to delete announcement');
  }
}
