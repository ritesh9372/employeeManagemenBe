import { db } from '../config/db.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, buildPaginationMeta } from '../utils/pagination.js';
import { logAudit } from '../utils/audit.js';
import { createNotification } from '../utils/notification.js';

export async function getPayrolls(req, res) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { employee_id, month, year, status, department_id } = req.query;

    let where = '1=1';
    const params = [];

    if (month) { where += ' AND p.month = ?'; params.push(month); }
    if (year) { where += ' AND p.year = ?'; params.push(year); }
    if (status) { where += ' AND p.status = ?'; params.push(status); }
    if (department_id) { where += ' AND e.department_id = ?'; params.push(department_id); }

    const userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'employee') {
      const [emp] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (emp.length === 0) return errorResponse(res, 'Employee not found', 404);
      where += ' AND p.employee_id = ?'; params.push(emp[0].id);
    } else if (userRole === 'manager') {
      const [mgr] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (mgr.length > 0) {
        where += ' AND (e.manager_id = ? OR p.employee_id = ?)';
        params.push(mgr[0].id, mgr[0].id);
      } else {
        where += ' AND 1=0';
      }
    } else if (employee_id) {
      where += ' AND p.employee_id = ?'; params.push(employee_id);
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM payroll p JOIN employees e ON p.employee_id = e.id WHERE ${where}`, params
    );

    const [rows] = await db.query(
      `SELECT p.*, CONCAT(e.first_name,' ',e.last_name) as employee_name, e.employee_code, d.name as department_name
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE ${where}
       ORDER BY p.year DESC, p.month DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginatedResponse(res, rows, buildPaginationMeta(total, page, limit));
  } catch (err) {
    return errorResponse(res, 'Failed to fetch payroll records');
  }
}

export async function getPayroll(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT p.*, CONCAT(e.first_name,' ',e.last_name) as employee_name, e.employee_code,
              e.designation_id, des.name as designation_name, d.name as department_name,
              e.bank_account, e.bank_name, e.ifsc_code
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       WHERE p.id = ?`, [req.params.id]
    );
    if (rows.length === 0) return errorResponse(res, 'Payroll record not found', 404);

    // Role check
    if (req.user.role === 'employee') {
      const [emp] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (emp.length === 0 || emp[0].id !== rows[0].employee_id) return errorResponse(res, 'Access denied', 403);
    }

    return successResponse(res, rows[0]);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch payroll record');
  }
}

export async function createPayroll(req, res) {
  try {
    const { employee_id, month, year, basic, hra, allowances, bonus, tax, deductions } = req.body;
    if (!employee_id || !month || !year) return errorResponse(res, 'Employee, month and year are required', 400);

    const gross = parseFloat(basic||0) + parseFloat(hra||0) + parseFloat(allowances||0) + parseFloat(bonus||0);
    const net = gross - parseFloat(tax||0) - parseFloat(deductions||0);

    const [result] = await db.query(
      `INSERT INTO payroll (employee_id, month, year, basic, hra, allowances, bonus, gross_salary, tax, deductions, net_salary)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [employee_id, month, year, basic||0, hra||0, allowances||0, bonus||0, gross, tax||0, deductions||0, net]
    );
    await logAudit(req.user.id, 'CREATE', 'payroll', result.insertId, `Created payroll for employee #${employee_id} month ${month}/${year}`, req.ip);
    return successResponse(res, { id: result.insertId, gross_salary: gross, net_salary: net }, 'Payroll created', 201);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return errorResponse(res, 'Payroll already exists for this employee/month/year', 409);
    return errorResponse(res, 'Failed to create payroll');
  }
}

export async function updatePayroll(req, res) {
  try {
    const { id } = req.params;
    const { basic, hra, allowances, bonus, tax, deductions } = req.body;

    const [existing] = await db.query('SELECT id, status FROM payroll WHERE id = ?', [id]);
    if (existing.length === 0) return errorResponse(res, 'Payroll not found', 404);
    if (existing[0].status === 'paid') return errorResponse(res, 'Cannot edit a paid payroll', 400);

    const gross = parseFloat(basic||0) + parseFloat(hra||0) + parseFloat(allowances||0) + parseFloat(bonus||0);
    const net = gross - parseFloat(tax||0) - parseFloat(deductions||0);

    await db.query(
      'UPDATE payroll SET basic=?, hra=?, allowances=?, bonus=?, gross_salary=?, tax=?, deductions=?, net_salary=? WHERE id=?',
      [basic||0, hra||0, allowances||0, bonus||0, gross, tax||0, deductions||0, net, id]
    );
    return successResponse(res, { gross_salary: gross, net_salary: net }, 'Payroll updated');
  } catch (err) {
    return errorResponse(res, 'Failed to update payroll');
  }
}

export async function processPayroll(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT p.*, e.user_id FROM payroll p JOIN employees e ON p.employee_id = e.id WHERE p.id = ?', [id]);
    if (rows.length === 0) return errorResponse(res, 'Payroll not found', 404);
    if (rows[0].status !== 'draft') return errorResponse(res, 'Only draft payrolls can be processed', 400);

    await db.query("UPDATE payroll SET status = 'processed' WHERE id = ?", [id]);
    if (rows[0].user_id) {
      await createNotification(rows[0].user_id, 'Payroll Processed', `Your salary for month ${rows[0].month}/${rows[0].year} has been processed.`, 'payroll', parseInt(id));
    }
    return successResponse(res, null, 'Payroll processed successfully');
  } catch (err) {
    return errorResponse(res, 'Failed to process payroll');
  }
}

export async function markAsPaid(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT p.*, e.user_id FROM payroll p JOIN employees e ON p.employee_id = e.id WHERE p.id = ?', [id]);
    if (rows.length === 0) return errorResponse(res, 'Payroll not found', 404);
    if (rows[0].status !== 'processed') return errorResponse(res, 'Only processed payrolls can be marked as paid', 400);

    const today = new Date().toISOString().split('T')[0];
    await db.query("UPDATE payroll SET status = 'paid', paid_on = ? WHERE id = ?", [today, id]);
    if (rows[0].user_id) {
      await createNotification(rows[0].user_id, 'Salary Credited', `Your salary of ₹${Number(rows[0].net_salary).toLocaleString('en-IN')} has been credited.`, 'payroll', parseInt(id));
    }
    return successResponse(res, null, 'Payroll marked as paid');
  } catch (err) {
    return errorResponse(res, 'Failed to mark payroll as paid');
  }
}

export async function deletePayroll(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT status FROM payroll WHERE id = ?', [id]);
    if (rows.length === 0) return errorResponse(res, 'Payroll not found', 404);
    if (rows[0].status !== 'draft') return errorResponse(res, 'Only draft payrolls can be deleted', 400);

    await db.query('DELETE FROM payroll WHERE id = ?', [id]);
    return successResponse(res, null, 'Payroll deleted');
  } catch (err) {
    return errorResponse(res, 'Failed to delete payroll');
  }
}
