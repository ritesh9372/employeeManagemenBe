import { db } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';

export async function getEmployeeReport(req, res) {
  try {
    const { department_id, designation_id, status, employment_type } = req.query;
    let where = '1=1';
    const params = [];
    if (department_id) { where += ' AND e.department_id = ?'; params.push(department_id); }
    if (designation_id) { where += ' AND e.designation_id = ?'; params.push(designation_id); }
    if (status) { where += ' AND e.status = ?'; params.push(status); }
    if (employment_type) { where += ' AND e.employment_type = ?'; params.push(employment_type); }

    const [rows] = await db.query(
      `SELECT e.employee_code, CONCAT(e.first_name,' ',e.last_name) as name, e.email, e.phone,
              d.name as department, des.name as designation, e.joining_date, e.employment_type, e.status, e.salary
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       WHERE ${where}
       ORDER BY d.name, e.first_name`,
      params
    );
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to generate employee report');
  }
}

export async function getAttendanceReport(req, res) {
  try {
    const { from_date, to_date, employee_id, department_id, status } = req.query;
    let where = '1=1';
    const params = [];
    if (from_date) { where += ' AND a.date >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND a.date <= ?'; params.push(to_date); }
    if (employee_id) { where += ' AND a.employee_id = ?'; params.push(employee_id); }
    if (department_id) { where += ' AND e.department_id = ?'; params.push(department_id); }
    if (status) { where += ' AND a.status = ?'; params.push(status); }

    const [rows] = await db.query(
      `SELECT a.date, e.employee_code, CONCAT(e.first_name,' ',e.last_name) as employee_name,
              d.name as department, a.check_in, a.check_out, a.working_hours, a.status, a.remarks
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE ${where}
       ORDER BY a.date DESC, e.first_name ASC`,
      params
    );
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to generate attendance report');
  }
}

export async function getLeaveReport(req, res) {
  try {
    const { from_date, to_date, employee_id, department_id, status, leave_type_id } = req.query;
    let where = '1=1';
    const params = [];
    if (from_date) { where += ' AND lr.start_date >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND lr.end_date <= ?'; params.push(to_date); }
    if (employee_id) { where += ' AND lr.employee_id = ?'; params.push(employee_id); }
    if (department_id) { where += ' AND e.department_id = ?'; params.push(department_id); }
    if (status) { where += ' AND lr.status = ?'; params.push(status); }
    if (leave_type_id) { where += ' AND lr.leave_type_id = ?'; params.push(leave_type_id); }

    const [rows] = await db.query(
      `SELECT e.employee_code, CONCAT(e.first_name,' ',e.last_name) as employee_name,
              d.name as department, lt.name as leave_type, lr.start_date, lr.end_date,
              lr.days, lr.status, lr.reason, lr.created_at
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE ${where}
       ORDER BY lr.created_at DESC`,
      params
    );
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to generate leave report');
  }
}

export async function getPayrollReport(req, res) {
  try {
    const { month, year, employee_id, department_id, status } = req.query;
    let where = '1=1';
    const params = [];
    if (month) { where += ' AND p.month = ?'; params.push(month); }
    if (year) { where += ' AND p.year = ?'; params.push(year); }
    if (employee_id) { where += ' AND p.employee_id = ?'; params.push(employee_id); }
    if (department_id) { where += ' AND e.department_id = ?'; params.push(department_id); }
    if (status) { where += ' AND p.status = ?'; params.push(status); }

    const [rows] = await db.query(
      `SELECT e.employee_code, CONCAT(e.first_name,' ',e.last_name) as employee_name,
              d.name as department, p.month, p.year, p.basic, p.hra, p.allowances, p.bonus,
              p.gross_salary, p.tax, p.deductions, p.net_salary, p.status, p.paid_on
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE ${where}
       ORDER BY p.year DESC, p.month DESC, e.first_name ASC`,
      params
    );
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to generate payroll report');
  }
}
