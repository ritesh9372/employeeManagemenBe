import { db } from '../config/db.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, buildPaginationMeta } from '../utils/pagination.js';
import { logAudit } from '../utils/audit.js';
import { createNotification } from '../utils/notification.js';
import { syncEmployeeBalances } from './policy.controller.js';
import bcrypt from 'bcrypt';

export async function getEmployees(req, res) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { search, department_id, designation_id, status, sort = 'e.created_at', order = 'DESC' } = req.query;

    let where = '1=1';
    const params = [];

    if (search) {
      where += ` AND (e.first_name LIKE ? OR e.last_name LIKE ? OR e.email LIKE ? OR e.employee_code LIKE ? OR e.phone LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }
    if (department_id) { where += ` AND e.department_id = ?`; params.push(department_id); }
    if (designation_id) { where += ` AND e.designation_id = ?`; params.push(designation_id); }
    if (status) { where += ` AND e.status = ?`; params.push(status); }

    // For manager or employee roles, scope results
    const userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'manager') {
      const [mgr] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (mgr.length > 0) {
        where += ` AND e.manager_id = ?`;
        params.push(mgr[0].id);
      }
    } else if (userRole === 'employee') {
      where += ` AND e.user_id = ?`;
      params.push(req.user.id);
    }

    const allowedSorts = ['e.created_at', 'e.first_name', 'e.last_name', 'e.joining_date', 'e.salary', 'e.employee_code'];
    const safeSort = allowedSorts.includes(sort) ? sort : 'e.created_at';
    const safeOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM employees e WHERE ${where}`, params);

    const [employees] = await db.query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.email, e.phone,
              e.department_id, d.name as department_name,
              e.designation_id, des.name as designation_name,
              e.manager_id, CONCAT(m.first_name, ' ', m.last_name) as manager_name,
              e.joining_date, e.employment_type, e.status, e.profile_photo, e.created_at
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       LEFT JOIN employees m ON e.manager_id = m.id
       WHERE ${where}
       ORDER BY ${safeSort} ${safeOrder}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginatedResponse(res, employees, buildPaginationMeta(total, page, limit));
  } catch (err) {
    console.error('Get employees error:', err);
    return errorResponse(res, 'Failed to fetch employees');
  }
}

export async function getEmployee(req, res) {
  try {
    const { id } = req.params;
    const userRole = (req.user.role || '').toLowerCase();

    if (userRole === 'manager') {
      const [mgr] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (mgr.length > 0) {
        const [teamCheck] = await db.query('SELECT id FROM employees WHERE id = ? AND (manager_id = ? OR id = ?)', [id, mgr[0].id, mgr[0].id]);
        if (teamCheck.length === 0) {
          return errorResponse(res, "You don't have permission to view this employee profile.", 403);
        }
      }
    } else if (userRole === 'employee') {
      const [emp] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (emp.length === 0 || emp[0].id !== parseInt(id)) {
        return errorResponse(res, "You don't have permission to view this employee profile.", 403);
      }
    }

    const [rows] = await db.query(
      `SELECT e.*, d.name as department_name, des.name as designation_name,
              CONCAT(m.first_name,' ',m.last_name) as manager_name,
              u.email as user_email, u.role
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       LEFT JOIN employees m ON e.manager_id = m.id
       LEFT JOIN users u ON e.user_id = u.id
       WHERE e.id = ?`, [id]
    );
    if (rows.length === 0) return errorResponse(res, 'Employee not found', 404);
    return successResponse(res, rows[0]);
  } catch (err) {
    console.error('Get employee error:', err);
    return errorResponse(res, 'Failed to fetch employee');
  }
}

export async function getEmployeeProfile(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT e.*, d.name as department_name, des.name as designation_name,
              CONCAT(m.first_name,' ',m.last_name) as manager_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       LEFT JOIN employees m ON e.manager_id = m.id
       WHERE e.user_id = ?`, [req.user.id]
    );
    if (rows.length === 0) return errorResponse(res, 'Employee profile not found', 404);
    return successResponse(res, rows[0]);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch profile');
  }
}

export async function createEmployee(req, res) {
  try {
    const {
      first_name, last_name, email, phone, dob, gender, address, city, state,
      department_id, designation_id, manager_id, joining_date, employment_type,
      salary, bank_account, bank_name, ifsc_code, emergency_contact, status = 'active',
      password
    } = req.body;

    if (!first_name || !last_name || !email) {
      return errorResponse(res, 'First name, last name and email are required', 400);
    }

    // Check email uniqueness
    const [existing] = await db.query('SELECT id FROM employees WHERE email = ?', [email]);
    if (existing.length > 0) return errorResponse(res, 'Email already exists', 409);

    // Validate manager if specified
    if (manager_id) {
      const [validMgr] = await db.query(
        `SELECT e.id FROM employees e JOIN users u ON e.user_id = u.id WHERE e.id = ? AND LOWER(u.role) = 'manager' AND e.status = 'active'`,
        [manager_id]
      );
      if (validMgr.length === 0) {
        return errorResponse(res, 'Selected manager is invalid, inactive, or does not have the Manager role.', 400);
      }
    }

    // Generate employee code
    const [[{ maxCode }]] = await db.query(`SELECT MAX(CAST(SUBSTRING(employee_code, 4) AS UNSIGNED)) as maxCode FROM employees WHERE employee_code LIKE 'EMP%'`);
    const empCode = `EMP${String((maxCode || 0) + 1).padStart(3, '0')}`;

    // Create user account
    const hashedPw = await bcrypt.hash(password || 'Emp@123', 10);
    const [userResult] = await db.query(
      'INSERT INTO users (name, email, password, role, is_active) VALUES (?,?,?,?,1)',
      [`${first_name} ${last_name}`, email, hashedPw, 'employee']
    );
    const userId = userResult.insertId;

    // Create employee
    const [empResult] = await db.query(
      `INSERT INTO employees (user_id, employee_code, first_name, last_name, email, phone, dob, gender, address, city, state,
        department_id, designation_id, manager_id, joining_date, employment_type, salary, bank_account, bank_name, ifsc_code, emergency_contact, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [userId, empCode, first_name, last_name, email, phone||null, dob||null, gender||null, address||null, city||null, state||null,
       department_id||null, designation_id||null, manager_id||null, joining_date||null, employment_type||'full_time',
       salary||0, bank_account||null, bank_name||null, ifsc_code||null, emergency_contact||null, status]
    );
    const empId = empResult.insertId;

    // Initialize leave balances based on highest priority active leave policy
    const year = new Date().getFullYear();
    await syncEmployeeBalances(empId, year);

    await createNotification(userId, 'Welcome to EMS', 'Your employee account has been created. Welcome aboard!', 'info');
    await logAudit(req.user.id, 'CREATE', 'employees', empId, `Created employee ${first_name} ${last_name} (${empCode})`, req.ip);

    return successResponse(res, { id: empId, employee_code: empCode }, 'Employee created successfully', 201);
  } catch (err) {
    console.error('Create employee error:', err);
    return errorResponse(res, 'Failed to create employee');
  }
}

export async function updateEmployee(req, res) {
  try {
    const { id } = req.params;
    const {
      first_name, last_name, phone, dob, gender, address, city, state,
      department_id, designation_id, manager_id, joining_date, employment_type,
      salary, bank_account, bank_name, ifsc_code, emergency_contact, status
    } = req.body;

    const [existing] = await db.query('SELECT id, user_id, first_name, last_name FROM employees WHERE id = ?', [id]);
    if (existing.length === 0) return errorResponse(res, 'Employee not found', 404);

    if (manager_id) {
      const [validMgr] = await db.query(
        `SELECT e.id FROM employees e JOIN users u ON e.user_id = u.id WHERE e.id = ? AND LOWER(u.role) = 'manager' AND e.status = 'active'`,
        [manager_id]
      );
      if (validMgr.length === 0) {
        return errorResponse(res, 'Selected manager is invalid, inactive, or does not have the Manager role.', 400);
      }
    }

    await db.query(
      `UPDATE employees SET first_name=?, last_name=?, phone=?, dob=?, gender=?, address=?, city=?, state=?,
        department_id=?, designation_id=?, manager_id=?, joining_date=?, employment_type=?,
        salary=?, bank_account=?, bank_name=?, ifsc_code=?, emergency_contact=?, status=?
       WHERE id = ?`,
      [first_name, last_name, phone||null, dob||null, gender||null, address||null, city||null, state||null,
       department_id||null, designation_id||null, manager_id||null, joining_date||null, employment_type||'full_time',
       salary||0, bank_account||null, bank_name||null, ifsc_code||null, emergency_contact||null, status||'active', id]
    );

    // Update user name too
    if (existing[0].user_id) {
      await db.query('UPDATE users SET name = ? WHERE id = ?', [`${first_name} ${last_name}`, existing[0].user_id]);
    }

    await logAudit(req.user.id, 'UPDATE', 'employees', parseInt(id), `Updated employee ${first_name} ${last_name}`, req.ip);
    return successResponse(res, null, 'Employee updated successfully');
  } catch (err) {
    console.error('Update employee error:', err);
    return errorResponse(res, 'Failed to update employee');
  }
}

export async function deleteEmployee(req, res) {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT id, first_name, last_name FROM employees WHERE id = ?', [id]);
    if (existing.length === 0) return errorResponse(res, 'Employee not found', 404);

    // Soft delete - just deactivate
    await db.query("UPDATE employees SET status = 'inactive' WHERE id = ?", [id]);
    await logAudit(req.user.id, 'DELETE', 'employees', parseInt(id), `Deactivated employee ${existing[0].first_name} ${existing[0].last_name}`, req.ip);
    return successResponse(res, null, 'Employee deactivated successfully');
  } catch (err) {
    return errorResponse(res, 'Failed to delete employee');
  }
}

export async function toggleEmployeeStatus(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT id, status, first_name, last_name FROM employees WHERE id = ?', [id]);
    if (rows.length === 0) return errorResponse(res, 'Employee not found', 404);

    const newStatus = rows[0].status === 'active' ? 'inactive' : 'active';
    await db.query('UPDATE employees SET status = ? WHERE id = ?', [newStatus, id]);
    await logAudit(req.user.id, 'UPDATE', 'employees', parseInt(id), `Set employee ${rows[0].first_name} ${rows[0].last_name} status to ${newStatus}`, req.ip);
    return successResponse(res, { status: newStatus }, `Employee ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`);
  } catch (err) {
    return errorResponse(res, 'Failed to toggle status');
  }
}

export async function uploadProfilePhoto(req, res) {
  try {
    const { id } = req.params;
    if (!req.file) return errorResponse(res, 'No file uploaded', 400);

    const photoPath = `/uploads/photos/${req.file.filename}`;
    await db.query('UPDATE employees SET profile_photo = ? WHERE id = ?', [photoPath, id]);
    return successResponse(res, { profile_photo: photoPath }, 'Photo uploaded successfully');
  } catch (err) {
    return errorResponse(res, 'Failed to upload photo');
  }
}
