import { db } from '../config/db.js';

export async function createUser(name, email, password) {
  const [result] = await db.execute(
    `INSERT INTO users (name, email, password)
     VALUES (?, ?, ?)`,
    [name, email, password]
  );

  return result;
}

export async function findUserByEmail(email) {
  const [rows] = await db.execute(
    `SELECT * FROM users WHERE email = ?`,
    [email]
  );

  return rows[0];
}