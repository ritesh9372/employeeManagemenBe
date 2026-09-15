import { db } from '../config/db.js';

export const createNotification = async (userId, title, message, type = 'info', referenceId = null) => {
  try {
    await db.query(
      `INSERT INTO notifications (user_id, title, message, type, reference_id) VALUES (?,?,?,?,?)`,
      [userId, title, message, type, referenceId]
    );
  } catch (e) { /* non-blocking */ }
};
