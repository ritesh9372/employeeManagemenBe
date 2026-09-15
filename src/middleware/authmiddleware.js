import jwt from 'jsonwebtoken';

export function authMiddleware(req, res, next) {

    try {

        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                message: 'Authorization header is required'
            });
        }

        const token = authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                message: 'Token is required'
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.user = decoded;

        next();

    } catch (error) {

        return res.status(403).json({
            message: 'Invalid or expired token'
        });
    }
}

export function roleMiddleware(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        const userRole = (req.user.role || '').toLowerCase();
        const normalizedAllowed = allowedRoles.map(r => r.toLowerCase());
        if (!normalizedAllowed.includes(userRole)) {
            return res.status(403).json({ success: false, message: "You don't have permission to perform this action." });
        }
        next();
    };
}

export const authorizeRoles = roleMiddleware;