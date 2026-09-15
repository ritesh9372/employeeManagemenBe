import { testdbconnection } from './src/config/db.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import morgan from 'morgan';

// Route imports
import authRoutes from './src/routes/authroute.js';
import employeeRoutes from './src/routes/employee.routes.js';
import departmentRoutes from './src/routes/department.routes.js';
import designationRoutes from './src/routes/designation.routes.js';
import attendanceRoutes from './src/routes/attendance.routes.js';
import leaveRoutes from './src/routes/leave.routes.js';
import payrollRoutes from './src/routes/payroll.routes.js';
import taskRoutes from './src/routes/task.routes.js';
import performanceRoutes from './src/routes/performance.routes.js';
import holidayRoutes from './src/routes/holiday.routes.js';
import announcementRoutes from './src/routes/announcement.routes.js';
import notificationRoutes from './src/routes/notification.routes.js';
import reportRoutes from './src/routes/report.routes.js';
import dashboardRoutes from './src/routes/dashboard.routes.js';
import profileRoutes from './src/routes/profile.routes.js';
import policyRoutes from './src/routes/policy.routes.js';
import departmentPolicyRoutes from './src/routes/departmentPolicy.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

await testdbconnection();

// Configure Morgan HTTP Logger (Format: METHOD URL STATUS RESPONSE_TIME ms)
app.use(morgan(':method :url :status :response-time[1] ms'));

app.use(cors({
  origin: ['http://localhost:4200', 'http://localhost:4000'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

import { getLeaveBalance, getAllLeaveBalances } from './src/controllers/leave.controller.js';
import { authMiddleware } from './src/middleware/authmiddleware.js';

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/designations', designationRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.get('/api/leave-balances/my', authMiddleware, getLeaveBalance);
app.get('/api/leave-balances', authMiddleware, getAllLeaveBalances);
app.use('/api/leave-policies', policyRoutes);
app.use('/api/department-leave-policies', departmentPolicyRoutes);
app.use('/api/payroll', payrollRoutes);


app.use('/api/tasks', taskRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/profile', profileRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Employee Management API', status: 'OK', timestamp: new Date() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

app.listen(3000, () => console.log('✅ Server running on http://localhost:3000'));