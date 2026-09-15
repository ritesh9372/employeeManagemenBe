import { db } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import bcrypt from 'bcrypt';

export async function getMe(req, res) {
  try {
    const [userRows] = await db.query('SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?', [req.user.id]);
    if (userRows.length === 0) return errorResponse(res, 'User not found', 404);

    const [empRows] = await db.query(
      `SELECT e.*, d.name as department_name, des.name as designation_name,
              CONCAT(m.first_name, ' ', m.last_name) as manager_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       LEFT JOIN employees m ON e.manager_id = m.id
       WHERE e.user_id = ?`, [req.user.id]
    );

    return successResponse(res, {
      user: userRows[0],
      employee: empRows[0] || null
    });
  } catch (err) {
    return errorResponse(res, 'Failed to fetch profile');
  }
}

export async function updateProfile(req, res) {
  try {
    const { name, phone, address, city, state, emergency_contact } = req.body;

    await db.query('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);

    const [empRows] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
    if (empRows.length > 0) {
      await db.query(
        'UPDATE employees SET phone=?, address=?, city=?, state=?, emergency_contact=? WHERE user_id=?',
        [phone||null, address||null, city||null, state||null, emergency_contact||null, req.user.id]
      );
    }

    return successResponse(res, null, 'Profile updated successfully');
  } catch (err) {
    return errorResponse(res, 'Failed to update profile');
  }
}

export async function changePassword(req, res) {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    if (!current_password || !new_password) return errorResponse(res, 'Current and new password are required', 400);
    if (new_password !== confirm_password) return errorResponse(res, 'Passwords do not match', 400);
    if (new_password.length < 6) return errorResponse(res, 'Password must be at least 6 characters', 400);

    const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return errorResponse(res, 'User not found', 404);

    const match = await bcrypt.compare(current_password, rows[0].password);
    if (!match) return errorResponse(res, 'Current password is incorrect', 400);

    const hashed = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);

    return successResponse(res, null, 'Password changed successfully');
  } catch (err) {
    return errorResponse(res, 'Failed to change password');
  }
}
