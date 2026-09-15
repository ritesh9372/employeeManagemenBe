import { db } from '../config/db.js';

export const logAudit = async (userId, action, module, recordId, description, ip = null) => {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, module, record_id, description, ip_address) VALUES (?,?,?,?,?,?)`,
      [userId, action, module, recordId || null, description, ip]
    );
  } catch (e) { /* non-blocking */ }
};
