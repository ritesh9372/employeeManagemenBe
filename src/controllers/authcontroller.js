import bcrypt from 'bcrypt';
import { db } from '../config/db.js';
import { generateToken } from '../utils/jwt.js';

export async function register(req, res) {
  try {
    const { name, email, password, confirmPassword, role } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'Name, email and password are required'
      });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        message: 'Passwords do not match'
      });
    }

    // Check existing email
    const [existingUser] = await db.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUser.length > 0) {
      return res.status(409).json({
        message: 'Email already registered'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = ['admin', 'hr', 'manager', 'employee'].includes(role) ? role : 'admin'; // Default admin for self-registered users if not specified

    // Save user
    const [result] = await db.query(
      `INSERT INTO users (name, email, password, role, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [name, email, hashedPassword, userRole]
    );
    const userId = result.insertId;

    // Auto-create employee record if email not in employees table
    const [existingEmp] = await db.query('SELECT id FROM employees WHERE email = ?', [email]);
    if (existingEmp.length === 0) {
      const nameParts = name.trim().split(' ');
      const firstName = nameParts[0] || 'User';
      const lastName = nameParts.slice(1).join(' ') || 'Employee';

      const [[{ maxCode }]] = await db.query(`SELECT MAX(CAST(SUBSTRING(employee_code, 4) AS UNSIGNED)) as maxCode FROM employees WHERE employee_code LIKE 'EMP%'`);
      const empCode = `EMP${String((maxCode || 0) + 1).padStart(3, '0')}`;

      await db.query(
        `INSERT INTO employees (user_id, employee_code, first_name, last_name, email, status, joining_date)
         VALUES (?, ?, ?, ?, ?, 'active', CURDATE())`,
        [userId, empCode, firstName, lastName, email]
      );
    } else {
      await db.query('UPDATE employees SET user_id = ? WHERE email = ?', [userId, email]);
    }

    // Also update existing user if registering with user email
    return res.status(201).json({
      message: 'User registered successfully',
      userId
    });

  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password are required'
      });
    }

    const [users] = await db.query(
      `SELECT id, name, email, password, role, is_active
       FROM users
       WHERE email = ?`,
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    const user = users[0];

    // Check account status
    if (user.is_active !== 1) {
      return res.status(403).json({
        message: 'Your account is inactive'
      });
    }

    // Check password
    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    // Generate JWT
    const token = generateToken(user);

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
}

export async function getManagers(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT e.id, e.user_id, CONCAT(e.first_name, ' ', e.last_name) as name, e.email, u.role
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE LOWER(u.role) = 'manager' AND e.status = 'active'
       ORDER BY e.first_name ASC`
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('Get managers error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch managers' });
  }
}