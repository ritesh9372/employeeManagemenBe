import { db } from '../config/db.js';

export async function getEmployees(req, res) {
    try {

        const [employees] = await db.query(
            `SELECT id, name, email, role, is_active, created_at
             FROM users`
        );

        return res.status(200).json({
            employees
        });

    } catch (error) {

        console.error('Get employees error:', error);

        return res.status(500).json({
            message: 'Internal server error'
        });
    }
}