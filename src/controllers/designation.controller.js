import { db } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export async function getDesignations(req, res) {
  try {
    const { department_id, status } = req.query;
    let where = '1=1';
    const params = [];
    if (department_id) { where += ' AND des.department_id = ?'; params.push(department_id); }
    if (status) { where += ' AND des.status = ?'; params.push(status); }

    const [rows] = await db.query(
      `SELECT des.*, d.name as department_name, COUNT(e.id) as employee_count
       FROM designations des
       LEFT JOIN departments d ON des.department_id = d.id
       LEFT JOIN employees e ON des.id = e.designation_id AND e.status = 'active'
       WHERE ${where}
       GROUP BY des.id ORDER BY des.name ASC`,
      params
    );
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch designations');
  }
}

export async function getDesignation(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT des.*, d.name as department_name FROM designations des LEFT JOIN departments d ON des.department_id = d.id WHERE des.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return errorResponse(res, 'Designation not found', 404);
    return successResponse(res, rows[0]);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch designation');
  }
}

export async function createDesignation(req, res) {
  try {
    const { name, department_id, description, level } = req.body;
    if (!name) return errorResponse(res, 'Designation name is required', 400);

    const [result] = await db.query(
      'INSERT INTO designations (name, department_id, description, level) VALUES (?,?,?,?)',
      [name, department_id || null, description || null, level || 1]
    );
    await logAudit(req.user.id, 'CREATE', 'designations', result.insertId, `Created designation ${name}`, req.ip);
    return successResponse(res, { id: result.insertId }, 'Designation created successfully', 201);
  } catch (err) {
    return errorResponse(res, 'Failed to create designation');
  }
}

export async function updateDesignation(req, res) {
  try {
    const { id } = req.params;
    const { name, department_id, description, level, status } = req.body;

    const [existing] = await db.query('SELECT id FROM designations WHERE id = ?', [id]);
    if (existing.length === 0) return errorResponse(res, 'Designation not found', 404);

    await db.query(
      'UPDATE designations SET name=?, department_id=?, description=?, level=?, status=? WHERE id=?',
      [name, department_id || null, description || null, level || 1, status || 'active', id]
    );
    await logAudit(req.user.id, 'UPDATE', 'designations', parseInt(id), `Updated designation ${name}`, req.ip);
    return successResponse(res, null, 'Designation updated successfully');
  } catch (err) {
    return errorResponse(res, 'Failed to update designation');
  }
}

export async function deleteDesignation(req, res) {
  try {
    const { id } = req.params;
    const [[{ count }]] = await db.query("SELECT COUNT(*) as count FROM employees WHERE designation_id = ? AND status = 'active'", [id]);
    if (count > 0) return errorResponse(res, 'Cannot delete designation with active employees', 400);

    await db.query('DELETE FROM designations WHERE id = ?', [id]);
    await logAudit(req.user.id, 'DELETE', 'designations', parseInt(id), `Deleted designation #${id}`, req.ip);
    return successResponse(res, null, 'Designation deleted successfully');
  } catch (err) {
    return errorResponse(res, 'Failed to delete designation');
  }
}

export async function toggleDesignationStatus(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT status FROM designations WHERE id = ?', [id]);
    if (rows.length === 0) return errorResponse(res, 'Designation not found', 404);
    const newStatus = rows[0].status === 'active' ? 'inactive' : 'active';
    await db.query('UPDATE designations SET status = ? WHERE id = ?', [newStatus, id]);
    return successResponse(res, { status: newStatus });
  } catch (err) {
    return errorResponse(res, 'Failed to update status');
  }
}
