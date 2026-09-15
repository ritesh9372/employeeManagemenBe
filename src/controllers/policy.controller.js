import { db } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

/**
 * 5-Level Priority Policy Resolution Engine:
 * 1. Employee-specific policy (EMPLOYEE)
 * 2. Department + Designation policy (DEPARTMENT_DESIGNATION)
 * 3. Designation policy (DESIGNATION)
 * 4. Department policy (DEPARTMENT)
 * 5. Company default policy (COMPANY)
 */
export async function resolveEmployeePolicy(emp, year) {
  const yr = parseInt(year);

  // 1. Employee Specific
  const [empPol] = await db.query(
    'SELECT * FROM leave_policies WHERE scope_type = "EMPLOYEE" AND employee_id = ? AND leave_year = ? AND is_active = 1',
    [emp.id, yr]
  );
  if (empPol.length > 0) return empPol[0];

  // 2. Department + Designation
  if (emp.department_id && emp.designation_id) {
    const [deptDesigPol] = await db.query(
      'SELECT * FROM leave_policies WHERE scope_type = "DEPARTMENT_DESIGNATION" AND department_id = ? AND designation_id = ? AND leave_year = ? AND is_active = 1',
      [emp.department_id, emp.designation_id, yr]
    );
    if (deptDesigPol.length > 0) return deptDesigPol[0];
  }

  // 3. Designation Specific
  if (emp.designation_id) {
    const [desigPol] = await db.query(
      'SELECT * FROM leave_policies WHERE scope_type = "DESIGNATION" AND designation_id = ? AND leave_year = ? AND is_active = 1',
      [emp.designation_id, yr]
    );
    if (desigPol.length > 0) return desigPol[0];
  }

  // Department Specific Default Policy from department_leave_policies table
  if (emp.department_id) {
    const [deptDlp] = await db.query(
      'SELECT * FROM department_leave_policies WHERE department_id = ? AND leave_year = ? AND is_active = 1',
      [emp.department_id, yr]
    );
    if (deptDlp.length > 0) {
      return {
        policy_name: 'Department Default Policy',
        scope_type: 'DEPARTMENT',
        casual_days: deptDlp[0].casual_days,
        sick_days: deptDlp[0].sick_days,
        earned_days: deptDlp[0].earned_days,
        unpaid_days: deptDlp[0].unpaid_allowed ? (deptDlp[0].unpaid_days || 30) : 0
      };
    }

    const [deptPol] = await db.query(
      'SELECT * FROM leave_policies WHERE scope_type = "DEPARTMENT" AND department_id = ? AND leave_year = ? AND is_active = 1',
      [emp.department_id, yr]
    );
    if (deptPol.length > 0) return deptPol[0];
  }


  // 5. Company Default
  const [companyPol] = await db.query(
    'SELECT * FROM leave_policies WHERE scope_type = "COMPANY" AND leave_year = ? AND is_active = 1',
    [yr]
  );
  if (companyPol.length > 0) return companyPol[0];

  // Fallback
  return {
    policy_name: 'System Default Policy',
    scope_type: 'DEFAULT',
    casual_days: 12,
    sick_days: 10,
    earned_days: 15,
    unpaid_days: 30
  };
}

/**
 * Sync leave balances for a single employee for a given year based on priority policy
 */
export async function syncEmployeeBalances(empId, year) {
  const [empRows] = await db.query('SELECT id, department_id, designation_id FROM employees WHERE id = ?', [empId]);
  if (empRows.length === 0) return;
  const emp = empRows[0];
  const policy = await resolveEmployeePolicy(emp, year);

  const [leaveTypes] = await db.query('SELECT id, name FROM leave_types');
  const policyQuotas = {
    casual: parseFloat(policy.casual_days || 12),
    sick: parseFloat(policy.sick_days || 10),
    earned: parseFloat(policy.earned_days || 15),
    unpaid: parseFloat(policy.unpaid_days || 30)
  };

  for (const lt of leaveTypes) {
    const ltName = lt.name.toLowerCase();
    let total = policyQuotas.casual;
    if (ltName.includes('sick')) total = policyQuotas.sick;
    else if (ltName.includes('earned')) total = policyQuotas.earned;
    else if (ltName.includes('unpaid')) total = policyQuotas.unpaid;

    const [existing] = await db.query(
      'SELECT id, used_days FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?',
      [empId, lt.id, year]
    );

    if (existing.length > 0) {
      const used = parseFloat(existing[0].used_days || 0);
      const rem = Math.max(0, total - used);
      await db.query(
        'UPDATE leave_balances SET total_days = ?, remaining_days = ? WHERE id = ?',
        [total, rem, existing[0].id]
      );
    } else {
      await db.query(
        'INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, remaining_days) VALUES (?,?,?,?,0,?)',
        [empId, lt.id, year, total, total]
      );
    }
  }
}

/**
 * Sync leave balances for all active employees for a given year
 */
export async function syncAllEmployeeBalances(year) {
  const [employees] = await db.query('SELECT id FROM employees WHERE status = "active"');
  for (const emp of employees) {
    await syncEmployeeBalances(emp.id, year);
  }
}

export async function getPolicies(req, res) {
  try {
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const { scope_type, department_id, designation_id, search } = req.query;

    let where = 'lp.leave_year = ?';
    const params = [year];

    if (scope_type) { where += ' AND lp.scope_type = ?'; params.push(scope_type); }
    if (department_id) { where += ' AND lp.department_id = ?'; params.push(department_id); }
    if (designation_id) { where += ' AND lp.designation_id = ?'; params.push(designation_id); }
    if (search) {
      where += ' AND (lp.policy_name LIKE ? OR d.name LIKE ? OR des.name LIKE ? OR e.first_name LIKE ? OR e.last_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }

    const [rows] = await db.query(
      `SELECT lp.*,
              d.name as department_name,
              des.name as designation_name,
              CONCAT(e.first_name, ' ', e.last_name) as employee_name, e.employee_code,
              u.name as creator_name
       FROM leave_policies lp
       LEFT JOIN departments d ON lp.department_id = d.id
       LEFT JOIN designations des ON lp.designation_id = des.id
       LEFT JOIN employees e ON lp.employee_id = e.id
       LEFT JOIN users u ON lp.created_by = u.id
       WHERE ${where}
       ORDER BY FIELD(lp.scope_type, 'EMPLOYEE', 'DEPARTMENT_DESIGNATION', 'DESIGNATION', 'DEPARTMENT', 'COMPANY'), lp.id DESC`,
      params
    );

    return successResponse(res, rows);
  } catch (err) {
    console.error('Get policies error:', err);
    return errorResponse(res, 'Failed to fetch leave policies');
  }
}

export async function getPolicy(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT lp.*, d.name as department_name, des.name as designation_name,
              CONCAT(e.first_name, ' ', e.last_name) as employee_name
       FROM leave_policies lp
       LEFT JOIN departments d ON lp.department_id = d.id
       LEFT JOIN designations des ON lp.designation_id = des.id
       LEFT JOIN employees e ON lp.employee_id = e.id
       WHERE lp.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) return errorResponse(res, 'Policy not found', 404);
    return successResponse(res, rows[0]);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch policy details');
  }
}

export async function createPolicy(req, res) {
  try {
    const {
      policy_name, scope_type, department_id, designation_id, employee_id,
      leave_year, casual_days, sick_days, earned_days, unpaid_days, description
    } = req.body;

    if (!policy_name || !scope_type || !leave_year) {
      return errorResponse(res, 'Policy Name, Scope Type, and Leave Year are required', 400);
    }

    const yr = parseInt(leave_year);
    const deptId = department_id ? parseInt(department_id) : null;
    const desigId = designation_id ? parseInt(designation_id) : null;
    const empId = employee_id ? parseInt(employee_id) : null;

    // Scope validation
    if (scope_type === 'DEPARTMENT' && !deptId) return errorResponse(res, 'Department is required for Department scope', 400);
    if (scope_type === 'DESIGNATION' && !desigId) return errorResponse(res, 'Designation is required for Designation scope', 400);
    if (scope_type === 'DEPARTMENT_DESIGNATION' && (!deptId || !desigId)) return errorResponse(res, 'Department and Designation are both required for Department + Designation scope', 400);
    if (scope_type === 'EMPLOYEE' && !empId) return errorResponse(res, 'Employee is required for Employee scope', 400);

    // Uniqueness check
    const [dupCheck] = await db.query(
      `SELECT id FROM leave_policies
       WHERE scope_type = ? AND leave_year = ? AND is_active = 1
         AND (department_id <=> ?)
         AND (designation_id <=> ?)
         AND (employee_id <=> ?)`,
      [scope_type, yr, deptId, desigId, empId]
    );

    if (dupCheck.length > 0) {
      return errorResponse(res, `An active leave policy already exists for this exact scope configuration in year ${yr}.`, 400);
    }

    const [result] = await db.query(
      `INSERT INTO leave_policies
       (policy_name, scope_type, department_id, designation_id, employee_id, leave_year,
        casual_days, sick_days, earned_days, unpaid_days, description, is_active, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`,
      [
        policy_name, scope_type, deptId, desigId, empId, yr,
        casual_days !== undefined ? parseFloat(casual_days) : 12,
        sick_days !== undefined ? parseFloat(sick_days) : 10,
        earned_days !== undefined ? parseFloat(earned_days) : 15,
        unpaid_days !== undefined ? parseFloat(unpaid_days) : 30,
        description || null, req.user.id
      ]
    );

    // Sync affected employee leave balances
    await syncAllEmployeeBalances(yr);
    await logAudit(req.user.id, 'CREATE', 'leave_policies', result.insertId, `Created leave policy '${policy_name}' for year ${yr}`, req.ip);

    return successResponse(res, { id: result.insertId }, 'Leave policy created and employee balances updated successfully', 201);
  } catch (err) {
    console.error('Create policy error:', err);
    return errorResponse(res, 'Failed to create leave policy');
  }
}

export async function updatePolicy(req, res) {
  try {
    const { id } = req.params;
    const {
      policy_name, casual_days, sick_days, earned_days, unpaid_days, description, is_active
    } = req.body;

    const [polRows] = await db.query('SELECT * FROM leave_policies WHERE id = ?', [id]);
    if (polRows.length === 0) return errorResponse(res, 'Policy not found', 404);

    const pol = polRows[0];
    await db.query(
      `UPDATE leave_policies SET
         policy_name = ?,
         casual_days = ?,
         sick_days = ?,
         earned_days = ?,
         unpaid_days = ?,
         description = ?,
         is_active = ?
       WHERE id = ?`,
      [
        policy_name || pol.policy_name,
        casual_days !== undefined ? parseFloat(casual_days) : pol.casual_days,
        sick_days !== undefined ? parseFloat(sick_days) : pol.sick_days,
        earned_days !== undefined ? parseFloat(earned_days) : pol.earned_days,
        unpaid_days !== undefined ? parseFloat(unpaid_days) : pol.unpaid_days,
        description !== undefined ? description : pol.description,
        is_active !== undefined ? (is_active ? 1 : 0) : pol.is_active,
        id
      ]
    );

    // Sync balances for that year
    await syncAllEmployeeBalances(pol.leave_year);
    await logAudit(req.user.id, 'UPDATE', 'leave_policies', parseInt(id), `Updated policy #${id}`, req.ip);

    return successResponse(res, null, 'Leave policy updated and balances recalculated successfully');
  } catch (err) {
    console.error('Update policy error:', err);
    return errorResponse(res, 'Failed to update leave policy');
  }
}

export async function deletePolicy(req, res) {
  try {
    const { id } = req.params;
    const [polRows] = await db.query('SELECT leave_year FROM leave_policies WHERE id = ?', [id]);
    if (polRows.length === 0) return errorResponse(res, 'Policy not found', 404);

    const yr = polRows[0].leave_year;
    await db.query('DELETE FROM leave_policies WHERE id = ?', [id]);

    // Recalculate balances using fallback policies
    await syncAllEmployeeBalances(yr);
    await logAudit(req.user.id, 'DELETE', 'leave_policies', parseInt(id), `Deleted policy #${id}`, req.ip);

    return successResponse(res, null, 'Leave policy deleted and balances updated');
  } catch (err) {
    return errorResponse(res, 'Failed to delete leave policy');
  }
}

export async function previewPolicy(req, res) {
  try {
    const { scope_type, department_id, designation_id, employee_id } = req.body;
    let where = 'e.status = "active"';
    const params = [];

    if (scope_type === 'DEPARTMENT' && department_id) {
      where += ' AND e.department_id = ?';
      params.push(department_id);
    } else if (scope_type === 'DESIGNATION' && designation_id) {
      where += ' AND e.designation_id = ?';
      params.push(designation_id);
    } else if (scope_type === 'DEPARTMENT_DESIGNATION' && department_id && designation_id) {
      where += ' AND e.department_id = ? AND e.designation_id = ?';
      params.push(department_id, designation_id);
    } else if (scope_type === 'EMPLOYEE' && employee_id) {
      where += ' AND e.id = ?';
      params.push(employee_id);
    }

    const [rows] = await db.query(
      `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', e.last_name) as name,
              d.name as department_name, des.name as designation_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       WHERE ${where}
       ORDER BY e.first_name ASC`,
      params
    );

    return successResponse(res, {
      total_affected: rows.length,
      employees: rows
    });
  } catch (err) {
    return errorResponse(res, 'Failed to generate policy preview');
  }
}

export async function syncAllBalancesEndpoint(req, res) {
  try {
    const year = req.body.year ? parseInt(req.body.year) : new Date().getFullYear();
    await syncAllEmployeeBalances(year);
    return successResponse(res, null, `Leave balances synchronized for all active employees for year ${year}`);
  } catch (err) {
    return errorResponse(res, 'Failed to sync balances');
  }
}

export async function getEmployeeCurrentPolicy(req, res) {
  try {
    const { employeeId } = req.params;
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();

    const [empRows] = await db.query(
      `SELECT e.*, d.name as department_name, des.name as designation_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       WHERE e.id = ?`,
      [employeeId]
    );

    if (empRows.length === 0) return errorResponse(res, 'Employee not found', 404);
    const emp = empRows[0];

    const currentPolicy = await resolveEmployeePolicy(emp, year);

    let designationPolicy = null;
    if (emp.designation_id) {
      const [desigRows] = await db.query(
        'SELECT * FROM leave_policies WHERE scope_type = "DESIGNATION" AND designation_id = ? AND leave_year = ? AND is_active = 1',
        [emp.designation_id, year]
      );
      if (desigRows.length > 0) designationPolicy = desigRows[0];
    }

    return successResponse(res, {
      employee: {
        id: emp.id,
        name: `${emp.first_name} ${emp.last_name}`,
        employee_code: emp.employee_code,
        department_name: emp.department_name,
        designation_name: emp.designation_name
      },
      current_policy: currentPolicy,
      designation_policy: designationPolicy
    });
  } catch (err) {
    console.error('Get employee current policy error:', err);
    return errorResponse(res, 'Failed to fetch employee current policy');
  }
}

