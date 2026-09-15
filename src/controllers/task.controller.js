import { db } from '../config/db.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, buildPaginationMeta } from '../utils/pagination.js';
import { logAudit } from '../utils/audit.js';
import { createNotification } from '../utils/notification.js';

export async function getTasks(req, res) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { status, priority, department_id, assigned_to } = req.query;

    let where = '1=1';
    const params = [];

    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (priority) { where += ' AND t.priority = ?'; params.push(priority); }
    if (department_id) { where += ' AND t.department_id = ?'; params.push(department_id); }
    if (assigned_to) { where += ' AND t.assigned_to = ?'; params.push(assigned_to); }

    const userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'employee') {
      const [emp] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (emp.length > 0) { where += ' AND t.assigned_to = ?'; params.push(emp[0].id); }
    } else if (userRole === 'manager') {
      // Manager sees tasks they created OR tasks for their team
      const [mgr] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (mgr.length > 0) {
        where += ' AND (t.created_by = ? OR e.manager_id = ? OR t.assigned_to = ?)';
        params.push(req.user.id, mgr[0].id, mgr[0].id);
      }
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM tasks t LEFT JOIN employees e ON t.assigned_to = e.id WHERE ${where}`, params
    );

    const [rows] = await db.query(
      `SELECT t.*, CONCAT(e.first_name,' ',e.last_name) as assigned_name,
              d.name as department_name, u.name as creator_name
       FROM tasks t
       LEFT JOIN employees e ON t.assigned_to = e.id
       LEFT JOIN departments d ON t.department_id = d.id
       LEFT JOIN users u ON t.created_by = u.id
       WHERE ${where}
       ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginatedResponse(res, rows, buildPaginationMeta(total, page, limit));
  } catch (err) {
    return errorResponse(res, 'Failed to fetch tasks');
  }
}

export async function getTask(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT t.*, CONCAT(e.first_name,' ',e.last_name) as assigned_name,
              d.name as department_name, u.name as creator_name
       FROM tasks t
       LEFT JOIN employees e ON t.assigned_to = e.id
       LEFT JOIN departments d ON t.department_id = d.id
       LEFT JOIN users u ON t.created_by = u.id
       WHERE t.id = ?`, [req.params.id]
    );
    if (rows.length === 0) return errorResponse(res, 'Task not found', 404);
    return successResponse(res, rows[0]);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch task');
  }
}

export async function createTask(req, res) {
  try {
    const { title, description, assigned_to, department_id, priority, status, start_date, due_date } = req.body;
    if (!title) return errorResponse(res, 'Task title is required', 400);

    const userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'manager' && assigned_to) {
      const [mgr] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (mgr.length > 0) {
        const [targetEmp] = await db.query('SELECT id FROM employees WHERE id = ? AND manager_id = ?', [assigned_to, mgr[0].id]);
        if (targetEmp.length === 0) {
          return errorResponse(res, 'You can only assign tasks to employees in your own team.', 403);
        }
      }
    } else if (userRole === 'employee') {
      return errorResponse(res, "Employees are not authorized to create or assign tasks.", 403);
    }

    const [result] = await db.query(
      'INSERT INTO tasks (title, description, assigned_to, department_id, created_by, priority, status, start_date, due_date) VALUES (?,?,?,?,?,?,?,?,?)',
      [title, description||null, assigned_to||null, department_id||null, req.user.id, priority||'medium', status||'todo', start_date||null, due_date||null]
    );

    // Notify assigned employee
    if (assigned_to) {
      const [emp] = await db.query('SELECT user_id FROM employees WHERE id = ?', [assigned_to]);
      if (emp.length > 0 && emp[0].user_id) {
        const creatorName = req.user.name || 'Manager';
        await createNotification(
          emp[0].user_id,
          'New Task Assigned',
          `${creatorName} assigned you a new task: "${title}".`,
          'task',
          result.insertId
        );
      }
    }

    await logAudit(req.user.id, 'CREATE', 'tasks', result.insertId, `Created task "${title}"`, req.ip);
    return successResponse(res, { id: result.insertId }, 'Task created successfully', 201);
  } catch (err) {
    return errorResponse(res, 'Failed to create task');
  }
}

export async function updateTask(req, res) {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT id, assigned_to, created_by FROM tasks WHERE id = ?', [id]);
    if (existing.length === 0) return errorResponse(res, 'Task not found', 404);

    // Employees can only update status
    if (req.user.role === 'employee') {
      const { status } = req.body;
      if (!status) return errorResponse(res, 'Status is required', 400);
      await db.query('UPDATE tasks SET status = ? WHERE id = ?', [status, id]);
      return successResponse(res, null, 'Task status updated');
    }

    const { title, description, assigned_to, department_id, priority, status, start_date, due_date } = req.body;
    await db.query(
      'UPDATE tasks SET title=?, description=?, assigned_to=?, department_id=?, priority=?, status=?, start_date=?, due_date=? WHERE id=?',
      [title, description||null, assigned_to||null, department_id||null, priority||'medium', status||'todo', start_date||null, due_date||null, id]
    );

    await logAudit(req.user.id, 'UPDATE', 'tasks', parseInt(id), `Updated task #${id}`, req.ip);
    return successResponse(res, null, 'Task updated successfully');
  } catch (err) {
    return errorResponse(res, 'Failed to update task');
  }
}

export async function deleteTask(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT id FROM tasks WHERE id = ?', [id]);
    if (rows.length === 0) return errorResponse(res, 'Task not found', 404);

    await db.query('DELETE FROM tasks WHERE id = ?', [id]);
    await logAudit(req.user.id, 'DELETE', 'tasks', parseInt(id), `Deleted task #${id}`, req.ip);
    return successResponse(res, null, 'Task deleted');
  } catch (err) {
    return errorResponse(res, 'Failed to delete task');
  }
}

export async function getTaskStats(req, res) {
  try {
    let where = '1=1';
    const params = [];

    if (req.user.role === 'employee') {
      const [emp] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (emp.length > 0) { where += ' AND assigned_to = ?'; params.push(emp[0].id); }
    } else if (req.user.role === 'manager') {
      where += ' AND created_by = ?'; params.push(req.user.id);
    }

    const today = new Date().toISOString().split('T')[0];
    const [[stats]] = await db.query(
      `SELECT
        SUM(status = 'todo') as todo,
        SUM(status = 'in_progress') as in_progress,
        SUM(status = 'review') as review,
        SUM(status = 'completed') as completed,
        SUM(status != 'completed' AND due_date < ?) as overdue
       FROM tasks WHERE ${where}`,
      [...params, today]
    );

    return successResponse(res, stats);
  } catch (err) {
    return errorResponse(res, 'Failed to get task stats');
  }
}
