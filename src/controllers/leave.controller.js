import { db } from '../config/db.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, buildPaginationMeta } from '../utils/pagination.js';
import { logAudit } from '../utils/audit.js';
import { createNotification } from '../utils/notification.js';

export async function getLeaveTypes(req, res) {
  try {
    const [rows] = await db.query('SELECT * FROM leave_types ORDER BY id ASC');
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch leave types');
  }
}

export async function getLeaveBalance(req, res) {
  try {
    const [empRows] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
    if (empRows.length === 0) return errorResponse(res, 'Employee not found', 404);

    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const [rows] = await db.query(
      `SELECT lb.*, lt.name as leave_type_name, lt.days_allowed
       FROM leave_balances lb JOIN leave_types lt ON lb.leave_type_id = lt.id
       WHERE lb.employee_id = ? AND lb.year = ?
       ORDER BY lt.id ASC`,
      [empRows[0].id, year]
    );
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch leave balance');
  }
}

export async function getAllLeaveBalances(req, res) {
  try {
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const { department_id, search, employee_id } = req.query;

    let where = 'e.status = "active"';
    const params = [];

    const userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'employee') {
      const [emp] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (emp.length === 0) return errorResponse(res, 'Employee profile not found', 404);
      where += ' AND e.id = ?';
      params.push(emp[0].id);
    } else if (userRole === 'manager') {
      const [mgr] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (mgr.length === 0) return errorResponse(res, 'Manager profile not found', 404);
      where += ' AND (e.manager_id = ? OR e.id = ?)';
      params.push(mgr[0].id, mgr[0].id);
    }

    if (employee_id) {
      where += ' AND e.id = ?';
      params.push(employee_id);
    }
    if (department_id) {
      where += ' AND e.department_id = ?';
      params.push(department_id);
    }
    if (search) {
      where += ' AND (e.first_name LIKE ? OR e.last_name LIKE ? OR e.employee_code LIKE ? OR e.email LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const [employees] = await db.query(
      `SELECT e.id as employee_id, e.employee_code, e.first_name, e.last_name, e.email, e.department_id,
              d.name as department_name, des.name as designation_name, e.user_id
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       WHERE ${where}
       ORDER BY e.first_name ASC, e.last_name ASC`,
      params
    );

    if (employees.length === 0) {
      return successResponse(res, []);
    }

    const empIds = employees.map(e => e.employee_id);
    const placeholders = empIds.map(() => '?').join(',');

    const [balances] = await db.query(
      `SELECT lb.*, lt.name as leave_type_name
       FROM leave_balances lb
       JOIN leave_types lt ON lb.leave_type_id = lt.id
       WHERE lb.employee_id IN (${placeholders}) AND lb.year = ?
       ORDER BY lt.id ASC`,
      [...empIds, year]
    );

    const balanceMap = {};
    for (const b of balances) {
      if (!balanceMap[b.employee_id]) balanceMap[b.employee_id] = [];
      balanceMap[b.employee_id].push(b);
    }

    const result = employees.map(emp => {
      const empBalances = balanceMap[emp.employee_id] || [];
      const getStat = (nameKey) => {
        const found = empBalances.find(b => b.leave_type_name.toLowerCase().includes(nameKey));
        return {
          total: found ? parseFloat(found.total_days) : 0,
          used: found ? parseFloat(found.used_days) : 0,
          remaining: found ? parseFloat(found.remaining_days) : 0
        };
      };

      return {
        ...emp,
        year,
        casual: getStat('casual'),
        sick: getStat('sick'),
        earned: getStat('earned'),
        unpaid: getStat('unpaid'),
        balances: empBalances
      };
    });

    return successResponse(res, result);
  } catch (err) {
    console.error('Fetch all leave balances error:', err);
    return errorResponse(res, 'Failed to fetch leave balances');
  }
}

export async function allocateSingleLeaveBalance(req, res) {
  try {
    const { employee_id, year, casual_total, sick_total, earned_total, unpaid_total } = req.body;
    if (!employee_id || !year) {
      return errorResponse(res, 'Employee ID and Leave Year are required', 400);
    }

    const [empRows] = await db.query('SELECT id, user_id, first_name, last_name FROM employees WHERE id = ?', [employee_id]);
    if (empRows.length === 0) return errorResponse(res, 'Employee not found', 404);

    const [leaveTypes] = await db.query('SELECT id, name FROM leave_types');
    const totalsMapping = {
      'casual': casual_total !== undefined ? parseFloat(casual_total) : 12,
      'sick': sick_total !== undefined ? parseFloat(sick_total) : 10,
      'earned': earned_total !== undefined ? parseFloat(earned_total) : 15,
      'unpaid': unpaid_total !== undefined ? parseFloat(unpaid_total) : 30
    };

    for (const lt of leaveTypes) {
      const ltName = lt.name.toLowerCase();
      let total = 0;
      if (ltName.includes('casual')) total = totalsMapping['casual'];
      else if (ltName.includes('sick')) total = totalsMapping['sick'];
      else if (ltName.includes('earned')) total = totalsMapping['earned'];
      else if (ltName.includes('unpaid')) total = totalsMapping['unpaid'];

      const [existing] = await db.query(
        'SELECT id, used_days FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?',
        [employee_id, lt.id, year]
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
          [employee_id, lt.id, year, total, total]
        );
      }
    }

    if (empRows[0].user_id) {
      await createNotification(
        empRows[0].user_id,
        'Leave Entitlement Updated',
        `Your leave entitlement for year ${year} has been updated.`,
        'leave'
      );
    }

    await logAudit(req.user.id, 'UPDATE', 'leave_balances', employee_id, `Updated leave entitlement for employee #${employee_id} (Year ${year})`, req.ip);
    return successResponse(res, null, 'Leave entitlement updated successfully');
  } catch (err) {
    console.error('Allocate single leave balance error:', err);
    return errorResponse(res, 'Failed to update leave entitlement');
  }
}

export async function allocateBulkLeaveBalance(req, res) {
  try {
    const { year, target, department_id, employee_id, casual_total, sick_total, earned_total, unpaid_total } = req.body;
    if (!year) return errorResponse(res, 'Leave Year is required', 400);

    let query = 'SELECT id, user_id FROM employees WHERE status = "active"';
    const params = [];

    if (target === 'department' && department_id) {
      query += ' AND department_id = ?';
      params.push(department_id);
    } else if (target === 'single' && employee_id) {
      query += ' AND id = ?';
      params.push(employee_id);
    }

    const [activeEmployees] = await db.query(query, params);
    if (activeEmployees.length === 0) {
      return errorResponse(res, 'No active employees found for the selected target scope', 404);
    }

    const [leaveTypes] = await db.query('SELECT id, name FROM leave_types');
    const cTotal = casual_total !== undefined ? parseFloat(casual_total) : 12;
    const sTotal = sick_total !== undefined ? parseFloat(sick_total) : 10;
    const eTotal = earned_total !== undefined ? parseFloat(earned_total) : 15;
    const uTotal = unpaid_total !== undefined ? parseFloat(unpaid_total) : 30;

    for (const emp of activeEmployees) {
      for (const lt of leaveTypes) {
        const ltName = lt.name.toLowerCase();
        let total = cTotal;
        if (ltName.includes('sick')) total = sTotal;
        else if (ltName.includes('earned')) total = eTotal;
        else if (ltName.includes('unpaid')) total = uTotal;

        const [existing] = await db.query(
          'SELECT id, used_days FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?',
          [emp.id, lt.id, year]
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
            [emp.id, lt.id, year, total, total]
          );
        }
      }
    }

    await logAudit(req.user.id, 'BULK_UPDATE', 'leave_balances', 0, `Bulk allocated leave entitlement for ${activeEmployees.length} employees (Year ${year})`, req.ip);
    return successResponse(res, { updated_count: activeEmployees.length }, `Leave entitlement updated for ${activeEmployees.length} employees.`);
  } catch (err) {
    console.error('Allocate bulk leave balance error:', err);
    return errorResponse(res, 'Failed to perform bulk leave allocation');
  }
}

export async function getLeaves(req, res) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { employee_id, department_id, status, leave_type_id, from_date, to_date } = req.query;

    let where = '1=1';
    const params = [];

    if (employee_id) { where += ' AND lr.employee_id = ?'; params.push(employee_id); }
    if (department_id) { where += ' AND e.department_id = ?'; params.push(department_id); }
    if (status) { where += ' AND lr.status = ?'; params.push(status); }
    if (leave_type_id) { where += ' AND lr.leave_type_id = ?'; params.push(leave_type_id); }
    if (from_date) { where += ' AND lr.start_date >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND lr.end_date <= ?'; params.push(to_date); }

    const userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'employee') {
      const [emp] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (emp.length > 0) { where += ' AND lr.employee_id = ?'; params.push(emp[0].id); }
    } else if (userRole === 'manager') {
      const [mgr] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (mgr.length > 0) { where += ' AND (e.manager_id = ? OR lr.employee_id = ?)'; params.push(mgr[0].id, mgr[0].id); }
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM leave_requests lr JOIN employees e ON lr.employee_id = e.id WHERE ${where}`, params
    );

    const [rows] = await db.query(
      `SELECT lr.*, CONCAT(e.first_name,' ',e.last_name) as employee_name, e.employee_code,
              lt.name as leave_type_name, d.name as department_name,
              u.name as approver_name
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN users u ON lr.approved_by = u.id
       WHERE ${where}
       ORDER BY lr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginatedResponse(res, rows, buildPaginationMeta(total, page, limit));
  } catch (err) {
    return errorResponse(res, 'Failed to fetch leave requests');
  }
}

export async function getLeave(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT lr.*, CONCAT(e.first_name,' ',e.last_name) as employee_name, lt.name as leave_type_name
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE lr.id = ?`, [req.params.id]
    );
    if (rows.length === 0) return errorResponse(res, 'Leave request not found', 404);
    return successResponse(res, rows[0]);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch leave request');
  }
}

export async function applyLeave(req, res) {
  try {
    const { leave_type_id, start_date, end_date, is_half_day, reason } = req.body;
    if (!leave_type_id || !start_date || !end_date) {
      return errorResponse(res, 'Leave type, start date and end date are required', 400);
    }

    const [empRows] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
    if (empRows.length === 0) return errorResponse(res, 'Employee not found', 404);
    const empId = empRows[0].id;

    let days = 0;
    if (is_half_day) {
      days = 0.5;
    } else {
      const start = new Date(start_date);
      const end = new Date(end_date);
      const cur = new Date(start);
      while (cur <= end) {
        const day = cur.getDay();
        if (day !== 0 && day !== 6) days++;
        cur.setDate(cur.getDate() + 1);
      }
    }

    if (days <= 0) return errorResponse(res, 'Invalid date range', 400);

    const year = new Date(start_date).getFullYear();
    const [balance] = await db.query(
      'SELECT id, remaining_days FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?',
      [empId, leave_type_id, year]
    );

    const [lt] = await db.query('SELECT name FROM leave_types WHERE id = ?', [leave_type_id]);
    const leaveName = lt[0]?.name || 'Leave';

    const isUnpaid = leaveName.toLowerCase().includes('unpaid');
    const available = balance.length > 0 ? parseFloat(balance[0].remaining_days) : 0;

    if (!isUnpaid && available < days) {
      return errorResponse(res, `Insufficient ${leaveName} balance. Available balance: ${available} days.`, 400);
    }

    const [result] = await db.query(
      'INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, is_half_day, reason) VALUES (?,?,?,?,?,?,?)',
      [empId, leave_type_id, start_date, end_date, days, is_half_day ? 1 : 0, reason || null]
    );

    const [hrUsers] = await db.query("SELECT id FROM users WHERE role IN ('admin','hr')");
    const empInfo = await db.query('SELECT first_name, last_name FROM employees WHERE id = ?', [empId]);
    const empName = empInfo[0][0] ? `${empInfo[0][0].first_name} ${empInfo[0][0].last_name}` : 'An employee';
    for (const hr of hrUsers) {
      await createNotification(hr.id, 'New Leave Request', `${empName} has applied for ${leaveName} (${days} days) from ${start_date} to ${end_date}`, 'leave', result.insertId);
    }

    await logAudit(req.user.id, 'CREATE', 'leave_requests', result.insertId, `Applied for ${days} days of ${leaveName}`, req.ip);
    return successResponse(res, { id: result.insertId, days }, 'Leave application submitted successfully', 201);
  } catch (err) {
    console.error('Apply leave error:', err);
    return errorResponse(res, 'Failed to apply for leave');
  }
}

export async function approveLeave(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT lr.*, lt.name as leave_type_name, e.user_id
       FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id = lt.id
       JOIN employees e ON lr.employee_id = e.id WHERE lr.id = ?`, [id]
    );
    if (rows.length === 0) return errorResponse(res, 'Leave request not found', 404);
    if (rows[0].status !== 'pending') return errorResponse(res, 'Leave request is not pending', 400);

    const leaveDays = parseFloat(rows[0].days);
    const leaveName = rows[0].leave_type_name.toLowerCase();
    const isUnpaid = leaveName.includes('unpaid');
    const year = new Date(rows[0].start_date).getFullYear();

    await db.query(
      "UPDATE leave_requests SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?",
      [req.user.id, id]
    );

    if (isUnpaid) {
      await db.query(
        `UPDATE leave_balances SET used_days = used_days + ?
         WHERE employee_id = ? AND leave_type_id = ? AND year = ?`,
        [leaveDays, rows[0].employee_id, rows[0].leave_type_id, year]
      );
    } else {
      await db.query(
        `UPDATE leave_balances SET used_days = used_days + ?, remaining_days = GREATEST(0, remaining_days - ?)
         WHERE employee_id = ? AND leave_type_id = ? AND year = ?`,
        [leaveDays, leaveDays, rows[0].employee_id, rows[0].leave_type_id, year]
      );
    }

    if (rows[0].user_id) {
      await createNotification(rows[0].user_id, 'Leave Approved', `Your ${rows[0].leave_type_name} request for ${leaveDays} day(s) has been approved.`, 'leave', parseInt(id));
    }

    await logAudit(req.user.id, 'APPROVE', 'leave_requests', parseInt(id), `Approved leave request #${id}`, req.ip);
    return successResponse(res, null, 'Leave request approved successfully');
  } catch (err) {
    console.error('Approve leave error:', err);
    return errorResponse(res, 'Failed to approve leave');
  }
}

export async function rejectLeave(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const [rows] = await db.query(
      `SELECT lr.*, lt.name as leave_type_name, e.user_id FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id JOIN employees e ON lr.employee_id = e.id WHERE lr.id = ?`, [id]
    );
    if (rows.length === 0) return errorResponse(res, 'Leave request not found', 404);
    if (rows[0].status !== 'pending') return errorResponse(res, 'Leave request is not pending', 400);

    await db.query("UPDATE leave_requests SET status = 'rejected', approved_by = ?, approved_at = NOW() WHERE id = ?", [req.user.id, id]);

    if (rows[0].user_id) {
      await createNotification(rows[0].user_id, 'Leave Rejected', `Your ${rows[0].leave_type_name} request has been rejected.`, 'leave', parseInt(id));
    }

    await logAudit(req.user.id, 'REJECT', 'leave_requests', parseInt(id), `Rejected leave request #${id}`, req.ip);
    return successResponse(res, null, 'Leave request rejected');
  } catch (err) {
    return errorResponse(res, 'Failed to reject leave');
  }
}

export async function cancelLeave(req, res) {
  try {
    const { id } = req.params;
    const [empRows] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
    if (empRows.length === 0) return errorResponse(res, 'Employee not found', 404);

    const [rows] = await db.query(
      `SELECT lr.*, lt.name as leave_type_name FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE lr.id = ? AND lr.employee_id = ?`,
      [id, empRows[0].id]
    );
    if (rows.length === 0) return errorResponse(res, 'Leave request not found', 404);
    if (!['pending', 'approved'].includes(rows[0].status)) return errorResponse(res, 'Cannot cancel this leave request', 400);

    const wasApproved = rows[0].status === 'approved';
    const leaveDays = parseFloat(rows[0].days);
    const leaveName = rows[0].leave_type_name.toLowerCase();
    const isUnpaid = leaveName.includes('unpaid');
    const year = new Date(rows[0].start_date).getFullYear();

    await db.query("UPDATE leave_requests SET status = 'cancelled' WHERE id = ?", [id]);

    if (wasApproved) {
      if (isUnpaid) {
        await db.query(
          `UPDATE leave_balances SET used_days = GREATEST(0, used_days - ?)
           WHERE employee_id = ? AND leave_type_id = ? AND year = ?`,
          [leaveDays, rows[0].employee_id, rows[0].leave_type_id, year]
        );
      } else {
        await db.query(
          `UPDATE leave_balances SET used_days = GREATEST(0, used_days - ?), remaining_days = remaining_days + ?
           WHERE employee_id = ? AND leave_type_id = ? AND year = ?`,
          [leaveDays, leaveDays, rows[0].employee_id, rows[0].leave_type_id, year]
        );
      }
    }

    return successResponse(res, null, 'Leave request cancelled successfully');
  } catch (err) {
    console.error('Cancel leave error:', err);
    return errorResponse(res, 'Failed to cancel leave');
  }
}
