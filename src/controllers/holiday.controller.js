import { db } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export async function getHolidays(req, res) {
  try {
    const { year, upcoming } = req.query;
    let where = '1=1';
    const params = [];
    if (year) { where += ' AND YEAR(date) = ?'; params.push(year); }
    if (upcoming === 'true') { where += ' AND date >= CURDATE()'; }

    const [rows] = await db.query(`SELECT * FROM holidays WHERE ${where} ORDER BY date ASC`, params);
    return successResponse(res, rows);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch holidays');
  }
}

export async function getHoliday(req, res) {
  try {
    const [rows] = await db.query('SELECT * FROM holidays WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return errorResponse(res, 'Holiday not found', 404);
    return successResponse(res, rows[0]);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch holiday');
  }
}

export async function createHoliday(req, res) {
  try {
    const { name, date, description, type } = req.body;
    if (!name || !date) return errorResponse(res, 'Holiday name and date are required', 400);

    const [result] = await db.query(
      'INSERT INTO holidays (name, date, description, type) VALUES (?,?,?,?)',
      [name, date, description||null, type||'public']
    );
    await logAudit(req.user.id, 'CREATE', 'holidays', result.insertId, `Created holiday ${name} on ${date}`, req.ip);
    return successResponse(res, { id: result.insertId }, 'Holiday created', 201);
  } catch (err) {
    return errorResponse(res, 'Failed to create holiday');
  }
}

export async function updateHoliday(req, res) {
  try {
    const { id } = req.params;
    const { name, date, description, type } = req.body;

    const [existing] = await db.query('SELECT id FROM holidays WHERE id = ?', [id]);
    if (existing.length === 0) return errorResponse(res, 'Holiday not found', 404);

    await db.query('UPDATE holidays SET name=?, date=?, description=?, type=? WHERE id=?',
      [name, date, description||null, type||'public', id]);
    return successResponse(res, null, 'Holiday updated');
  } catch (err) {
    return errorResponse(res, 'Failed to update holiday');
  }
}

export async function deleteHoliday(req, res) {
  try {
    const [rows] = await db.query('SELECT id FROM holidays WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return errorResponse(res, 'Holiday not found', 404);
    await db.query('DELETE FROM holidays WHERE id = ?', [req.params.id]);
    return successResponse(res, null, 'Holiday deleted');
  } catch (err) {
    return errorResponse(res, 'Failed to delete holiday');
  }
}
