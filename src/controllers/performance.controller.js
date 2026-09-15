import { db } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { createNotification } from '../utils/notification.js';

export async function getReviews(req, res) {
  try {
    const { employee_id, review_period } = req.query;
    let where = '1=1';
    const params = [];

    if (employee_id) { where += ' AND pr.employee_id = ?'; params.push(employee_id); }
    if (review_period) { where += ' AND pr.review_period = ?'; params.push(review_period); }

    const userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'employee') {
      const [emp] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (emp.length > 0) { where += ' AND pr.employee_id = ?'; params.push(emp[0].id); }
    } else if (userRole === 'manager') {
      const [mgr] = await db.query('SELECT id FROM employees WHERE user_id = ?', [req.user.id]);
      if (mgr.length > 0) { where += ' AND (e.manager_id = ? OR pr.employee_id = ?)'; params.push(mgr[0].id, mgr[0].id); }
    }

    const [rows] = await db.query(
      `SELECT pr.*, CONCAT(e.first_name,' ',e.last_name) as employee_name, e.employee_code,
              d.name as department_name, u.name as reviewer_name
       FROM performance_reviews pr
       JOIN employees e ON pr.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN users u ON pr.reviewer_id = u.id
       WHERE ${where}
       ORDER BY pr.created_at DESC`,
      params
    );
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch performance reviews');
  }
}

export async function getReview(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT pr.*, CONCAT(e.first_name,' ',e.last_name) as employee_name, u.name as reviewer_name
       FROM performance_reviews pr
       JOIN employees e ON pr.employee_id = e.id
       LEFT JOIN users u ON pr.reviewer_id = u.id
       WHERE pr.id = ?`, [req.params.id]
    );
    if (rows.length === 0) return errorResponse(res, 'Review not found', 404);
    return successResponse(res, rows[0]);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch review');
  }
}

export async function createReview(req, res) {
  try {
    const { employee_id, review_period, attendance_score, productivity_score, quality_score, teamwork_score, communication_score, strengths, improvements, comments } = req.body;
    if (!employee_id) return errorResponse(res, 'Employee is required', 400);

    const overall = ((Number(attendance_score)||0) + (Number(productivity_score)||0) + (Number(quality_score)||0) + (Number(teamwork_score)||0) + (Number(communication_score)||0)) / 5;

    const [result] = await db.query(
      `INSERT INTO performance_reviews (employee_id, reviewer_id, review_period, attendance_score, productivity_score, quality_score, teamwork_score, communication_score, overall_rating, strengths, improvements, comments)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [employee_id, req.user.id, review_period||null, attendance_score||null, productivity_score||null, quality_score||null, teamwork_score||null, communication_score||null, overall.toFixed(1), strengths||null, improvements||null, comments||null]
    );

    const [emp] = await db.query('SELECT user_id FROM employees WHERE id = ?', [employee_id]);
    if (emp.length > 0 && emp[0].user_id) {
      await createNotification(emp[0].user_id, 'Performance Review Completed', `Your performance review for ${review_period||'this period'} has been submitted. Overall rating: ${overall.toFixed(1)}/5`, 'performance', result.insertId);
    }

    await logAudit(req.user.id, 'CREATE', 'performance_reviews', result.insertId, `Created performance review for employee #${employee_id}`, req.ip);
    return successResponse(res, { id: result.insertId, overall_rating: overall.toFixed(1) }, 'Performance review created', 201);
  } catch (err) {
    return errorResponse(res, 'Failed to create review');
  }
}

export async function updateReview(req, res) {
  try {
    const { id } = req.params;
    const { review_period, attendance_score, productivity_score, quality_score, teamwork_score, communication_score, strengths, improvements, comments } = req.body;

    const [existing] = await db.query('SELECT id FROM performance_reviews WHERE id = ?', [id]);
    if (existing.length === 0) return errorResponse(res, 'Review not found', 404);

    const overall = ((Number(attendance_score)||0) + (Number(productivity_score)||0) + (Number(quality_score)||0) + (Number(teamwork_score)||0) + (Number(communication_score)||0)) / 5;

    await db.query(
      `UPDATE performance_reviews SET review_period=?, attendance_score=?, productivity_score=?, quality_score=?, teamwork_score=?, communication_score=?, overall_rating=?, strengths=?, improvements=?, comments=? WHERE id=?`,
      [review_period||null, attendance_score||null, productivity_score||null, quality_score||null, teamwork_score||null, communication_score||null, overall.toFixed(1), strengths||null, improvements||null, comments||null, id]
    );
    return successResponse(res, null, 'Review updated');
  } catch (err) {
    return errorResponse(res, 'Failed to update review');
  }
}

export async function deleteReview(req, res) {
  try {
    const [rows] = await db.query('SELECT id FROM performance_reviews WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return errorResponse(res, 'Review not found', 404);
    await db.query('DELETE FROM performance_reviews WHERE id = ?', [req.params.id]);
    return successResponse(res, null, 'Review deleted');
  } catch (err) {
    return errorResponse(res, 'Failed to delete review');
  }
}
