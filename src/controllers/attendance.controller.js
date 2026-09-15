import { db } from '../config/db.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, buildPaginationMeta } from '../utils/pagination.js';

/**
 * Format minutes into "Xh Ym" string format
 */
function formatWorkingHours(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return '0h 00m';
  const hrs = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  return `${hrs}h ${mins < 10 ? '0' : ''}${mins}m`;
}

export async function checkIn(req, res) {
  try {
    const [empRows] = await db.query('SELECT id, status FROM employees WHERE user_id = ?', [req.user.id]);
    if (empRows.length === 0) return errorResponse(res, 'Employee record not found', 404);
    if (empRows[0].status === 'inactive') return errorResponse(res, 'Inactive employee account cannot check in', 403);
    const empId = empRows[0].id;

    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS

    const workMode = req.body.work_mode || 'Office';
    const validModes = ['Office', 'Work From Home', 'Hybrid'];
    const finalWorkMode = validModes.includes(workMode) ? workMode : 'Office';

    const [existing] = await db.query(
      'SELECT id, check_in, work_mode FROM attendance WHERE employee_id = ? AND date = ?',
      [empId, today]
    );

    if (existing.length > 0 && existing[0].check_in) {
      return errorResponse(res, 'Already checked in for today', 409);
    }

    // Determine status: Present if check-in <= 09:15 AM, Late if after 09:15 AM
    const hour = now.getHours();
    const minutes = now.getMinutes();
    const isLate = hour > 9 || (hour === 9 && minutes > 15);
    const status = isLate ? 'late' : 'present';

    if (existing.length > 0) {
      await db.query(
        'UPDATE attendance SET check_in = ?, status = ?, work_mode = ? WHERE id = ?',
        [timeStr, status, finalWorkMode, existing[0].id]
      );
    } else {
      await db.query(
        'INSERT INTO attendance (employee_id, date, check_in, status, work_mode) VALUES (?,?,?,?,?)',
        [empId, today, timeStr, status, finalWorkMode]
      );
    }

    return successResponse(
      res,
      { check_in: timeStr, status, date: today, work_mode: finalWorkMode },
      'Checked in successfully'
    );
  } catch (err) {
    console.error('Check in error:', err);
    return errorResponse(res, 'Failed to check in');
  }
}

export async function checkOut(req, res) {
  try {
    const [empRows] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
    if (empRows.length === 0) return errorResponse(res, 'Employee record not found', 404);
    const empId = empRows[0].id;

    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    const [rows] = await db.query(
      'SELECT id, check_in, check_out FROM attendance WHERE employee_id = ? AND date = ?',
      [empId, today]
    );

    if (rows.length === 0 || !rows[0].check_in) {
      return errorResponse(res, 'You must check in before checking out', 400);
    }

    if (rows[0].check_out) {
      return errorResponse(res, 'Already checked out for today', 409);
    }

    const [ih, im] = rows[0].check_in.split(':').map(Number);
    const checkInMinutes = ih * 60 + im;
    const checkOutMinutes = now.getHours() * 60 + now.getMinutes();
    const totalMinutes = Math.max(0, checkOutMinutes - checkInMinutes);
    const workingHoursNum = (totalMinutes / 60).toFixed(2);
    const formattedHours = formatWorkingHours(totalMinutes);

    await db.query(
      'UPDATE attendance SET check_out = ?, working_hours = ? WHERE id = ?',
      [timeStr, workingHoursNum, rows[0].id]
    );

    return successResponse(
      res,
      { check_out: timeStr, working_hours: workingHoursNum, formatted_working_hours: formattedHours },
      'Checked out successfully'
    );
  } catch (err) {
    console.error('Check out error:', err);
    return errorResponse(res, 'Failed to check out');
  }
}

export async function getTodayAttendance(req, res) {
  try {
    const [empRows] = await db.query('SELECT id, first_name, last_name FROM employees WHERE user_id = ?', [req.user.id]);
    if (empRows.length === 0) return errorResponse(res, 'Employee not found', 404);

    const today = new Date().toISOString().split('T')[0];
    const [rows] = await db.query('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [empRows[0].id, today]);

    if (rows.length === 0) {
      return successResponse(res, null);
    }

    const record = rows[0];
    let formatted_working_hours = '0h 00m';

    if (record.check_in) {
      const [ih, im] = record.check_in.split(':').map(Number);
      const checkInMinutes = ih * 60 + im;
      let checkOutMinutes;

      if (record.check_out) {
        const [oh, om] = record.check_out.split(':').map(Number);
        checkOutMinutes = oh * 60 + om;
      } else {
        const now = new Date();
        checkOutMinutes = now.getHours() * 60 + now.getMinutes();
      }

      const totalMins = Math.max(0, checkOutMinutes - checkInMinutes);
      formatted_working_hours = formatWorkingHours(totalMins);
    }

    return successResponse(res, {
      ...record,
      formatted_working_hours
    });
  } catch (err) {
    console.error('Get today attendance error:', err);
    return errorResponse(res, 'Failed to fetch attendance');
  }
}

export async function getAttendance(req, res) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { employee_id, department_id, status, work_mode, from_date, to_date, search } = req.query;

    let where = '1=1';
    const params = [];

    if (employee_id) { where += ' AND a.employee_id = ?'; params.push(employee_id); }
    if (department_id) { where += ' AND e.department_id = ?'; params.push(department_id); }
    if (status) { where += ' AND a.status = ?'; params.push(status); }
    if (work_mode) { where += ' AND a.work_mode = ?'; params.push(work_mode); }
    if (from_date) { where += ' AND a.date >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND a.date <= ?'; params.push(to_date); }
    if (search) {
      where += ' AND (e.first_name LIKE ? OR e.last_name LIKE ? OR e.employee_code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Role-based scoping: non-admin/non-hr only sees own records or team records
    const userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'employee') {
      const [emp] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (emp.length > 0) {
        where += ' AND a.employee_id = ?';
        params.push(emp[0].id);
      } else {
        where += ' AND 1=0';
      }
    } else if (userRole === 'manager') {
      const [mgr] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (mgr.length > 0) {
        where += ' AND (e.manager_id = ? OR a.employee_id = ?)';
        params.push(mgr[0].id, mgr[0].id);
      } else {
        where += ' AND 1=0';
      }
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE ${where}`, params
    );

    const [rows] = await db.query(
      `SELECT a.*, CONCAT(e.first_name,' ',e.last_name) as employee_name, e.employee_code,
              d.name as department_name
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE ${where}
       ORDER BY a.date DESC, e.first_name ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Format working hours for UI display
    const formattedRows = rows.map(r => {
      let formatted_working_hours = '-';
      if (r.working_hours) {
        const totalMins = Math.round(parseFloat(r.working_hours) * 60);
        formatted_working_hours = formatWorkingHours(totalMins);
      }
      return { ...r, formatted_working_hours };
    });

    return paginatedResponse(res, formattedRows, buildPaginationMeta(total, page, limit));
  } catch (err) {
    console.error('Get attendance error:', err);
    return errorResponse(res, 'Failed to fetch attendance');
  }
}

export async function getEmployeeAttendance(req, res) {
  try {
    const { id } = req.params;
    const { from_date, to_date } = req.query;

    let where = 'a.employee_id = ?';
    const params = [id];
    if (from_date) { where += ' AND a.date >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND a.date <= ?'; params.push(to_date); }

    const [rows] = await db.query(
      `SELECT a.* FROM attendance a WHERE ${where} ORDER BY a.date DESC LIMIT 60`, params
    );

    const summary = {
      present: rows.filter(r => r.status === 'present').length,
      late: rows.filter(r => r.status === 'late').length,
      absent: rows.filter(r => r.status === 'absent').length,
      leave: rows.filter(r => r.status === 'leave').length,
    };

    return successResponse(res, { records: rows, summary });
  } catch (err) {
    return errorResponse(res, 'Failed to fetch attendance');
  }
}

export async function updateAttendance(req, res) {
  try {
    const { id } = req.params;
    const { check_in, check_out, status, work_mode, remarks } = req.body;

    const [existing] = await db.query('SELECT id FROM attendance WHERE id = ?', [id]);
    if (existing.length === 0) return errorResponse(res, 'Attendance record not found', 404);

    let working_hours = null;
    if (check_in && check_out) {
      const [ih, im] = check_in.split(':').map(Number);
      const [oh, om] = check_out.split(':').map(Number);
      working_hours = Math.max(0, ((oh * 60 + om) - (ih * 60 + im)) / 60).toFixed(2);
    }

    await db.query(
      'UPDATE attendance SET check_in=?, check_out=?, working_hours=?, status=?, work_mode=?, remarks=? WHERE id=?',
      [check_in || null, check_out || null, working_hours, status || 'present', work_mode || 'Office', remarks || null, id]
    );

    return successResponse(res, null, 'Attendance updated successfully');
  } catch (err) {
    return errorResponse(res, 'Failed to update attendance');
  }
}
