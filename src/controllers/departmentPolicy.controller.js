import { db } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

/**
 * Synchronize leave balances for all active employees in a department for a specific year
 * based on the department's default leave policy.
 */
export async function syncDepartmentEmployeeBalances(departmentId, year) {
  const yr = parseInt(year);
  const deptId = parseInt(departmentId);

  // Fetch active department policy
  const [polRows] = await db.query(
    'SELECT * FROM department_leave_policies WHERE department_id = ? AND leave_year = ? AND is_active = 1',
    [deptId, yr]
  );

  const policy = polRows.length > 0 ? polRows[0] : {
    casual_days: 12,
    sick_days: 10,
    earned_days: 15,
    unpaid_allowed: 1,
    unpaid_days: 30
  };

  const policyQuotas = {
    casual: parseFloat(policy.casual_days || 12),
    sick: parseFloat(policy.sick_days || 10),
    earned: parseFloat(policy.earned_days || 15),
    unpaid: policy.unpaid_allowed ? parseFloat(policy.unpaid_days || 30) : 0
  };

  // Get active employees in department
  const [employees] = await db.query(
    'SELECT id FROM employees WHERE department_id = ? AND status = "active"',
    [deptId]
  );

  const [leaveTypes] = await db.query('SELECT id, name FROM leave_types');

  for (const emp of employees) {
    for (const lt of leaveTypes) {
      const ltName = lt.name.toLowerCase();
      let total = policyQuotas.casual;
      if (ltName.includes('sick')) total = policyQuotas.sick;
      else if (ltName.includes('earned')) total = policyQuotas.earned;
      else if (ltName.includes('unpaid')) total = policyQuotas.unpaid;

      // Calculate approved used days from approved leave requests
      const [[{ approved_used }]] = await db.query(
        `SELECT COALESCE(SUM(days), 0) as approved_used
         FROM leave_requests
         WHERE employee_id = ? AND leave_type_id = ? AND status = 'approved' AND YEAR(start_date) = ?`,
        [emp.id, lt.id, yr]
      );

      const used = parseFloat(approved_used || 0);
      const rem = Math.max(0, total - used);

      const [existing] = await db.query(
        'SELECT id FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?',
        [emp.id, lt.id, yr]
      );

      if (existing.length > 0) {
        await db.query(
          'UPDATE leave_balances SET total_days = ?, used_days = ?, remaining_days = ? WHERE id = ?',
          [total, used, rem, existing[0].id]
        );
      } else {
        await db.query(
          'INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, remaining_days) VALUES (?,?,?,?,?,?)',
          [emp.id, lt.id, yr, total, used, rem]
        );
      }
    }
  }
}

/**
 * GET /api/department-leave-policies
 * Fetch all department leave policies
 */
export async function getDepartmentPolicies(req, res) {
  try {
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const { department_id, search } = req.query;

    let where = '1=1';
    const params = [];

    if (year) { where += ' AND dlp.leave_year = ?'; params.push(year); }
    if (department_id) { where += ' AND dlp.department_id = ?'; params.push(department_id); }
    if (search) {
      where += ' AND (d.name LIKE ? OR u.name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

    const [rows] = await db.query(
      `SELECT dlp.*,
              d.name as department_name,
              u.name as creator_name
       FROM department_leave_policies dlp
       JOIN departments d ON dlp.department_id = d.id
       LEFT JOIN users u ON dlp.created_by = u.id
       WHERE ${where}
       ORDER BY d.name ASC, dlp.leave_year DESC`,
      params
    );

    return successResponse(res, rows);
  } catch (err) {
    console.error('Get department policies error:', err);
    return errorResponse(res, 'Failed to fetch department leave policies');
  }
}

/**
 * GET /api/department-leave-policies/:id
 * Fetch single department leave policy by ID
 */
export async function getDepartmentPolicy(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT dlp.*, d.name as department_name, u.name as creator_name
       FROM department_leave_policies dlp
       JOIN departments d ON dlp.department_id = d.id
       LEFT JOIN users u ON dlp.created_by = u.id
       WHERE dlp.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) return errorResponse(res, 'Department leave policy not found', 404);
    return successResponse(res, rows[0]);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch department leave policy');
  }
}

/**
 * POST /api/department-leave-policies
 * Create a new department default leave policy
 */
export async function createDepartmentPolicy(req, res) {
  try {
    const { department_id, leave_year, casual_days, sick_days, earned_days, unpaid_allowed, unpaid_days } = req.body;

    if (!department_id || !leave_year) {
      return errorResponse(res, 'Department and Leave Year are required', 400);
    }

    const deptId = parseInt(department_id);
    const yr = parseInt(leave_year);
    const cDays = casual_days !== undefined ? parseFloat(casual_days) : 12;
    const sDays = sick_days !== undefined ? parseFloat(sick_days) : 10;
    const eDays = earned_days !== undefined ? parseFloat(earned_days) : 15;
    const uAllowed = unpaid_allowed !== undefined ? (unpaid_allowed ? 1 : 0) : 1;
    const uDays = unpaid_days !== undefined ? parseFloat(unpaid_days) : 30;

    if (cDays < 0 || sDays < 0 || eDays < 0 || uDays < 0) {
      return errorResponse(res, 'Leave days cannot be negative values', 400);
    }

    // Check if department exists
    const [deptRows] = await db.query('SELECT name FROM departments WHERE id = ?', [deptId]);
    if (deptRows.length === 0) {
      return errorResponse(res, 'Department not found', 404);
    }
    const deptName = deptRows[0].name;

    // Duplicate Check: ONE default policy per department_id + leave_year
    const [existing] = await db.query(
      'SELECT id FROM department_leave_policies WHERE department_id = ? AND leave_year = ?',
      [deptId, yr]
    );

    if (existing.length > 0) {
      return errorResponse(
        res,
        `Default leave policy already exists for ${deptName} for ${yr}.`,
        409
      );
    }

    const [result] = await db.query(
      `INSERT INTO department_leave_policies
       (department_id, leave_year, casual_days, sick_days, earned_days, unpaid_allowed, unpaid_days, is_active, created_by)
       VALUES (?,?,?,?,?,?,?,1,?)`,
      [deptId, yr, cDays, sDays, eDays, uAllowed, uDays, req.user.id]
    );

    // Sync employee leave balances in that department
    await syncDepartmentEmployeeBalances(deptId, yr);
    await logAudit(req.user.id, 'CREATE', 'department_leave_policies', result.insertId, `Created default leave policy for ${deptName} (${yr})`, req.ip);

    return successResponse(res, { id: result.insertId }, `Default leave policy for ${deptName} (${yr}) created successfully`, 201);
  } catch (err) {
    console.error('Create department policy error:', err);
    return errorResponse(res, 'Failed to create department leave policy');
  }
}

/**
 * PUT /api/department-leave-policies/:id
 * Update an existing department leave policy
 */
export async function updateDepartmentPolicy(req, res) {
  try {
    const { id } = req.params;
    const { casual_days, sick_days, earned_days, unpaid_allowed, unpaid_days, is_active } = req.body;

    const [polRows] = await db.query('SELECT * FROM department_leave_policies WHERE id = ?', [id]);
    if (polRows.length === 0) return errorResponse(res, 'Department leave policy not found', 404);

    const pol = polRows[0];
    const cDays = casual_days !== undefined ? parseFloat(casual_days) : pol.casual_days;
    const sDays = sick_days !== undefined ? parseFloat(sick_days) : pol.sick_days;
    const eDays = earned_days !== undefined ? parseFloat(earned_days) : pol.earned_days;
    const uAllowed = unpaid_allowed !== undefined ? (unpaid_allowed ? 1 : 0) : pol.unpaid_allowed;
    const uDays = unpaid_days !== undefined ? parseFloat(unpaid_days) : pol.unpaid_days;
    const active = is_active !== undefined ? (is_active ? 1 : 0) : pol.is_active;

    if (cDays < 0 || sDays < 0 || eDays < 0 || uDays < 0) {
      return errorResponse(res, 'Leave days cannot be negative values', 400);
    }

    await db.query(
      `UPDATE department_leave_policies SET
         casual_days = ?,
         sick_days = ?,
         earned_days = ?,
         unpaid_allowed = ?,
         unpaid_days = ?,
         is_active = ?
       WHERE id = ?`,
      [cDays, sDays, eDays, uAllowed, uDays, active, id]
    );

    // Sync department employee leave balances
    await syncDepartmentEmployeeBalances(pol.department_id, pol.leave_year);
    await logAudit(req.user.id, 'UPDATE', 'department_leave_policies', parseInt(id), `Updated department policy #${id}`, req.ip);

    return successResponse(res, null, 'Department default leave policy updated successfully');
  } catch (err) {
    console.error('Update department policy error:', err);
    return errorResponse(res, 'Failed to update department leave policy');
  }
}

/**
 * PATCH /api/department-leave-policies/:id/deactivate
 * Toggle active / inactive status of a department leave policy
 */
export async function deactivateDepartmentPolicy(req, res) {
  try {
    const { id } = req.params;
    const [polRows] = await db.query('SELECT * FROM department_leave_policies WHERE id = ?', [id]);
    if (polRows.length === 0) return errorResponse(res, 'Department leave policy not found', 404);

    const pol = polRows[0];
    const newStatus = pol.is_active ? 0 : 1;

    await db.query('UPDATE department_leave_policies SET is_active = ? WHERE id = ?', [newStatus, id]);
    await syncDepartmentEmployeeBalances(pol.department_id, pol.leave_year);

    const actionText = newStatus ? 'activated' : 'deactivated';
    await logAudit(req.user.id, 'TOGGLE_STATUS', 'department_leave_policies', parseInt(id), `${actionText.toUpperCase()} policy #${id}`, req.ip);

    return successResponse(res, { is_active: newStatus }, `Department leave policy ${actionText} successfully`);
  } catch (err) {
    return errorResponse(res, 'Failed to update policy status');
  }
}
