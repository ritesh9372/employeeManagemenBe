import { db } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export async function getDepartments(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT d.*, u.name as head_name, COUNT(e.id) as employee_count
       FROM departments d
       LEFT JOIN users u ON d.head_id = u.id
       LEFT JOIN employees e ON d.id = e.department_id AND e.status = 'active'
       GROUP BY d.id
       ORDER BY d.name ASC`
    );
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch departments');
  }
}

export async function getDepartment(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT d.*, u.name as head_name FROM departments d LEFT JOIN users u ON d.head_id = u.id WHERE d.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return errorResponse(res, 'Department not found', 404);
    return successResponse(res, rows[0]);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch department');
  }
}

export async function createDepartment(req, res) {
  try {
    const { name, description, head_id } = req.body;
    if (!name) return errorResponse(res, 'Department name is required', 400);

    const [existing] = await db.query('SELECT id FROM departments WHERE name = ?', [name]);
    if (existing.length > 0) return errorResponse(res, 'Department name already exists', 409);

    const [result] = await db.query(
      'INSERT INTO departments (name, description, head_id) VALUES (?,?,?)',
      [name, description || null, head_id || null]
    );
    await logAudit(req.user.id, 'CREATE', 'departments', result.insertId, `Created department ${name}`, req.ip);
    return successResponse(res, { id: result.insertId }, 'Department created successfully', 201);
  } catch (err) {
    return errorResponse(res, 'Failed to create department');
  }
}

export async function updateDepartment(req, res) {
  try {
    const { id } = req.params;
    const { name, description, head_id, status } = req.body;

    const [existing] = await db.query('SELECT id FROM departments WHERE id = ?', [id]);
    if (existing.length === 0) return errorResponse(res, 'Department not found', 404);

    // Check name uniqueness (excluding current)
    if (name) {
      const [dup] = await db.query('SELECT id FROM departments WHERE name = ? AND id != ?', [name, id]);
      if (dup.length > 0) return errorResponse(res, 'Department name already exists', 409);
    }

    await db.query(
      'UPDATE departments SET name=?, description=?, head_id=?, status=? WHERE id=?',
      [name, description || null, head_id || null, status || 'active', id]
    );
    await logAudit(req.user.id, 'UPDATE', 'departments', parseInt(id), `Updated department ${name}`, req.ip);
    return successResponse(res, null, 'Department updated successfully');
  } catch (err) {
    return errorResponse(res, 'Failed to update department');
  }
}

export async function deleteDepartment(req, res) {
  try {
    const { id } = req.params;
    const [[{ count }]] = await db.query(
      "SELECT COUNT(*) as count FROM employees WHERE department_id = ? AND status = 'active'", [id]
    );
    if (count > 0) return errorResponse(res, 'Cannot delete department with active employees', 400);

    await db.query('DELETE FROM departments WHERE id = ?', [id]);
    await logAudit(req.user.id, 'DELETE', 'departments', parseInt(id), `Deleted department #${id}`, req.ip);
    return successResponse(res, null, 'Department deleted successfully');
  } catch (err) {
    return errorResponse(res, 'Failed to delete department');
  }
}

export async function toggleDepartmentStatus(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT id, status FROM departments WHERE id = ?', [id]);
    if (rows.length === 0) return errorResponse(res, 'Department not found', 404);

    const newStatus = rows[0].status === 'active' ? 'inactive' : 'active';
    await db.query('UPDATE departments SET status = ? WHERE id = ?', [newStatus, id]);
    return successResponse(res, { status: newStatus }, `Department ${newStatus}`);
  } catch (err) {
    return errorResponse(res, 'Failed to update status');
  }
}
