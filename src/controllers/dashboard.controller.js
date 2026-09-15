import { db } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';

export async function getAdminDashboard(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    // 1. Employee stats
    const [[empStats]] = await db.query(
      `SELECT
        COUNT(*) as totalEmployees,
        COALESCE(SUM(status = 'active'), 0) as activeEmployees,
        COALESCE(SUM(status = 'inactive'), 0) as inactiveEmployees,
        COALESCE(SUM(MONTH(joining_date) = ? AND YEAR(joining_date) = ?), 0) as newJoinersThisMonth
       FROM employees`,
      [currentMonth, currentYear]
    );

    // 2. Departments count
    const [[deptRes]] = await db.query(`SELECT COUNT(*) as totalDepartments FROM departments WHERE status = 'active'`);
    const totalDepartments = deptRes?.totalDepartments || 0;

    // 3. Managers count
    const [[mgrRes]] = await db.query(`SELECT COUNT(*) as totalManagers FROM users WHERE role = 'manager' AND is_active = 1`);
    const totalManagers = mgrRes?.totalManagers || 0;

    // 4. Attendance Stats for Today
    const [[attStats]] = await db.query(
      `SELECT
        COALESCE(SUM(status = 'present'), 0) as present,
        COALESCE(SUM(status = 'absent'), 0) as absent,
        COALESCE(SUM(status = 'late'), 0) as late,
        COALESCE(SUM(status = 'leave'), 0) as \`leave\`,
        COALESCE(SUM(status = 'half_day'), 0) as halfDay
       FROM attendance WHERE date = ?`,
      [today]
    );

    // On leave today
    const [[leaveRes]] = await db.query(
      `SELECT COUNT(DISTINCT employee_id) as onLeave FROM leave_requests
       WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`, [today, today]
    );
    const onLeaveToday = leaveRes?.onLeave || 0;

    // Attendance rate
    const totalActive = empStats?.activeEmployees || 0;
    const totalPresentAndLate = (attStats?.present || 0) + (attStats?.late || 0);
    const attendanceRate = totalActive > 0 ? parseFloat(((totalPresentAndLate / totalActive) * 100).toFixed(1)) : 0;

    // 5. Leave stats & Type breakdown
    const [[pendingLeaveRes]] = await db.query(
      `SELECT COUNT(*) as pendingLeaveRequests FROM leave_requests WHERE status = 'pending'`
    );
    const pendingLeaveRequests = pendingLeaveRes?.pendingLeaveRequests || 0;

    const [[leaveStats]] = await db.query(
      `SELECT
        COALESCE(SUM(status = 'approved'), 0) as approved,
        COALESCE(SUM(status = 'pending'), 0) as pending,
        COALESCE(SUM(status = 'rejected'), 0) as rejected,
        COALESCE(SUM(status = 'cancelled'), 0) as cancelled
       FROM leave_requests WHERE YEAR(created_at) = ?`,
      [currentYear]
    );

    const [leaveTypeBreakdown] = await db.query(
      `SELECT lt.name as leave_type, COUNT(lr.id) as count
       FROM leave_types lt
       LEFT JOIN leave_requests lr ON lt.id = lr.leave_type_id AND YEAR(lr.created_at) = ?
       GROUP BY lt.id, lt.name`,
      [currentYear]
    );

    // Pending Leave Requests List (for inline approval)
    const [pendingLeavesList] = await db.query(
      `SELECT lr.id, lr.employee_id, CONCAT(e.first_name, ' ', e.last_name) as employee_name,
              e.employee_code, d.name as department_name, lt.name as leave_type,
              lr.start_date, lr.end_date, lr.days, lr.reason, lr.status, lr.created_at
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE lr.status = 'pending'
       ORDER BY lr.created_at DESC LIMIT 10`
    );

    // 6. Payroll stats (Current & Previous month)
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    const [[currentPayrollRes]] = await db.query(
      `SELECT COALESCE(SUM(net_salary), 0) as totalMonthlyPayroll,
              COALESCE(SUM(status = 'paid'), 0) as paidCount,
              COALESCE(SUM(status = 'pending'), 0) as pendingCount,
              COALESCE(SUM(CASE WHEN status = 'pending' THEN net_salary ELSE 0 END), 0) as pendingAmount
       FROM payroll WHERE month = ? AND year = ? AND status != 'draft'`,
      [currentMonth, currentYear]
    );

    const [[prevPayrollRes]] = await db.query(
      `SELECT COALESCE(SUM(net_salary), 0) as prevMonthlyPayroll
       FROM payroll WHERE month = ? AND year = ? AND status != 'draft'`,
      [prevMonth, prevYear]
    );

    const currAmount = parseFloat(currentPayrollRes?.totalMonthlyPayroll || 0);
    const prevAmount = parseFloat(prevPayrollRes?.prevMonthlyPayroll || 0);
    const payrollDifference = currAmount - prevAmount;

    const [monthlyPayrollData] = await db.query(
      `SELECT CONCAT(p.year, '-', LPAD(p.month, 2, '0')) as month,
              COALESCE(SUM(p.net_salary), 0) as amount
       FROM payroll p WHERE p.status != 'draft'
       AND (p.year * 100 + p.month) >= ?
       GROUP BY p.year, p.month ORDER BY p.year ASC, p.month ASC LIMIT 6`,
      [(currentYear * 100 + currentMonth - 5)]
    );

    // 7. Tasks
    const [[taskStats]] = await db.query(
      `SELECT
        COUNT(*) as total,
        COALESCE(SUM(status = 'todo'), 0) as todo,
        COALESCE(SUM(status = 'in_progress'), 0) as in_progress,
        COALESCE(SUM(status = 'review'), 0) as review,
        COALESCE(SUM(status = 'completed'), 0) as completed,
        COALESCE(SUM(status != 'completed' AND due_date < CURDATE()), 0) as overdue
       FROM tasks`
    );

    // 8. Employee growth trend (last 6 months employee registration)
    const [employeeGrowth] = await db.query(
      `SELECT CONCAT(YEAR(joining_date), '-', LPAD(MONTH(joining_date), 2, '0')) as month,
              COUNT(*) as count
       FROM employees
       WHERE joining_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY YEAR(joining_date), MONTH(joining_date)
       ORDER BY month ASC`
    );

    // 9. Department distribution
    const [departmentDistribution] = await db.query(
      `SELECT d.name, COUNT(e.id) as count
       FROM departments d
       LEFT JOIN employees e ON d.id = e.department_id AND e.status = 'active'
       WHERE d.status = 'active'
       GROUP BY d.id, d.name ORDER BY count DESC`
    );

    // 10. Performance avg rating
    const [[perfStats]] = await db.query(
      `SELECT AVG(overall_rating) as avgRating FROM performance_reviews`
    );

    // 11. Upcoming holidays
    const [upcomingHolidays] = await db.query(
      `SELECT id, name, date, type FROM holidays WHERE date >= CURDATE() ORDER BY date ASC LIMIT 5`
    );

    // 12. Recent employees & leave requests & audit activities
    const [recentEmployees] = await db.query(
      `SELECT e.id, e.first_name, e.last_name, e.email, e.employee_code, e.profile_photo,
              d.name as department_name, e.joining_date
       FROM employees e LEFT JOIN departments d ON e.department_id = d.id
       ORDER BY e.created_at DESC LIMIT 5`
    );

    const [recentActivities] = await db.query(
      `SELECT a.*, u.name as user_name FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 6`
    );

    const [notifications] = await db.query(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`, [req.user.id]
    );

    const [announcements] = await db.query(
      `SELECT a.*, u.name as created_by_name FROM announcements a JOIN users u ON a.created_by = u.id ORDER BY a.created_at DESC LIMIT 5`
    );

    return successResponse(res, {
      totalEmployees: empStats?.totalEmployees || 0,
      activeEmployees: empStats?.activeEmployees || 0,
      inactiveEmployees: empStats?.inactiveEmployees || 0,
      newJoinersThisMonth: empStats?.newJoinersThisMonth || 0,
      totalDepartments: totalDepartments || 0,
      totalManagers: totalManagers || 0,

      // Attendance
      presentToday: attStats?.present || 0,
      absentToday: attStats?.absent || 0,
      lateToday: attStats?.late || 0,
      halfDayToday: attStats?.halfDay || 0,
      onLeaveToday: onLeaveToday || 0,
      attendanceRate: attendanceRate,
      attendanceStats: {
        present: attStats?.present || 0,
        absent: attStats?.absent || 0,
        late: attStats?.late || 0,
        leave: attStats?.leave || 0,
        halfDay: attStats?.halfDay || 0
      },

      // Leaves
      pendingLeaveRequests: pendingLeaveRequests || 0,
      leaveStats: {
        approved: leaveStats?.approved || 0,
        pending: leaveStats?.pending || 0,
        rejected: leaveStats?.rejected || 0,
        cancelled: leaveStats?.cancelled || 0
      },
      leaveTypeBreakdown: leaveTypeBreakdown || [],
      pendingLeavesList: pendingLeavesList || [],

      // Payroll
      totalMonthlyPayroll: currAmount,
      payrollSummary: {
        currentMonthAmount: currAmount,
        prevMonthAmount: prevAmount,
        difference: payrollDifference,
        paidEmployeesCount: currentPayrollRes?.paidCount || 0,
        pendingPayrollCount: currentPayrollRes?.pendingCount || 0,
        pendingPayrollAmount: parseFloat(currentPayrollRes?.pendingAmount || 0)
      },
      monthlyPayrollData: monthlyPayrollData || [],

      // Tasks
      overdueTasks: taskStats?.overdue || 0,
      taskSummary: {
        total: taskStats?.total || 0,
        todo: taskStats?.todo || 0,
        in_progress: taskStats?.in_progress || 0,
        review: taskStats?.review || 0,
        completed: taskStats?.completed || 0,
        overdue: taskStats?.overdue || 0
      },

      // Growth & Distribution
      employeeGrowth: employeeGrowth || [],
      departmentDistribution: departmentDistribution || [],
      performanceSummary: { avgRating: parseFloat(perfStats?.avgRating || 0).toFixed(1) },

      // Lists
      upcomingHolidays: upcomingHolidays || [],
      recentEmployees: recentEmployees || [],
      recentActivities: recentActivities || [],
      notifications: notifications || [],
      announcements: announcements || []
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    return errorResponse(res, 'Failed to load dashboard data', 500);
  }
}

export async function getHRDashboard(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    const [[empStats]] = await db.query(
      `SELECT
        COUNT(*) as totalEmployees,
        COALESCE(SUM(status = 'active'), 0) as activeEmployees,
        COALESCE(SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0) as newEmployees
       FROM employees`
    );

    const [[attStats]] = await db.query(
      `SELECT
        COALESCE(SUM(status = 'present'), 0) as present,
        COALESCE(SUM(status = 'absent'), 0) as absent,
        COALESCE(SUM(status = 'late'), 0) as late,
        COALESCE(SUM(status = 'leave'), 0) as \`leave\`
       FROM attendance WHERE date = ?`,
      [today]
    );

    const [[pendingLeaveRes]] = await db.query(
      `SELECT COUNT(*) as pendingLeaveRequests FROM leave_requests WHERE status = 'pending'`
    );

    const [recentLeaves] = await db.query(
      `SELECT lr.id, CONCAT(e.first_name,' ',e.last_name) as employee_name,
              lt.name as leave_type_name, lr.start_date, lr.end_date, lr.days, lr.status
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE lr.status = 'pending' ORDER BY lr.created_at DESC LIMIT 5`
    );

    const [[payrollRes]] = await db.query(
      `SELECT COALESCE(SUM(net_salary), 0) as totalMonthlyPayroll FROM payroll WHERE month = ? AND year = ? AND status != 'draft'`,
      [currentMonth, currentYear]
    );

    const [departmentDistribution] = await db.query(
      `SELECT d.name, COUNT(e.id) as count
       FROM departments d LEFT JOIN employees e ON d.id = e.department_id AND e.status = 'active'
       WHERE d.status = 'active' GROUP BY d.id, d.name ORDER BY count DESC`
    );

    const [announcements] = await db.query(
      `SELECT a.*, u.name as created_by_name FROM announcements a JOIN users u ON a.created_by = u.id ORDER BY a.created_at DESC LIMIT 5`
    );

    const [notifications] = await db.query(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`, [req.user.id]
    );

    const [upcomingHolidays] = await db.query(
      `SELECT name, date, type FROM holidays WHERE date >= CURDATE() ORDER BY date ASC LIMIT 5`
    );

    return successResponse(res, {
      totalEmployees: empStats?.totalEmployees || 0,
      activeEmployees: empStats?.activeEmployees || 0,
      newEmployees: empStats?.newEmployees || 0,
      attendanceSummary: {
        present: attStats?.present || 0,
        absent: attStats?.absent || 0,
        late: attStats?.late || 0,
        leave: attStats?.leave || 0
      },
      pendingLeaveCount: pendingLeaveRes?.pendingLeaveRequests || 0,
      pendingLeaves: recentLeaves || [],
      totalMonthlyPayroll: parseFloat(payrollRes?.totalMonthlyPayroll || 0),
      departmentDistribution: departmentDistribution || [],
      announcements: announcements || [],
      notifications: notifications || [],
      upcomingHolidays: upcomingHolidays || []
    });
  } catch (err) {
    console.error('HR dashboard error:', err);
    return errorResponse(res, 'Failed to load HR dashboard', 500);
  }
}

export async function getManagerDashboard(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [managerRow] = await db.query('SELECT id, first_name, last_name FROM employees WHERE user_id = ?', [req.user.id]);
    const managerId = managerRow[0]?.id || null;

    let teamSize = 0;
    let presentToday = 0;
    let absentToday = 0;
    let pendingLeaves = 0;
    let teamAttendance = [];
    let pendingLeaveRequests = [];
    let teamTasks = [];
    let pendingTasks = 0;
    let overdueTasks = 0;
    let teamPerformance = [];

    if (managerId) {
      const [[tsRes]] = await db.query(
        `SELECT COUNT(*) as teamSize FROM employees WHERE manager_id = ? AND status = 'active'`, [managerId]
      );
      teamSize = tsRes?.teamSize || 0;

      const [[ptRes]] = await db.query(
        `SELECT
          COALESCE(SUM(a.status IN ('present','late')), 0) as presentToday,
          COALESCE(SUM(a.status = 'absent'), 0) as absentToday
         FROM attendance a
         JOIN employees e ON a.employee_id = e.id
         WHERE e.manager_id = ? AND a.date = ?`,
        [managerId, today]
      );
      presentToday = ptRes?.presentToday || 0;
      absentToday = (teamSize - presentToday);

      const [ta] = await db.query(
        `SELECT a.*, CONCAT(e.first_name,' ',e.last_name) as employee_name, e.employee_code, e.profile_photo
         FROM employees e
         LEFT JOIN attendance a ON e.id = a.employee_id AND a.date = ?
         WHERE e.manager_id = ? AND e.status = 'active'`,
        [today, managerId]
      );
      teamAttendance = ta || [];

      const [[plRes]] = await db.query(
        `SELECT COUNT(*) as pendingLeaves FROM leave_requests lr
         JOIN employees e ON lr.employee_id = e.id
         WHERE e.manager_id = ? AND lr.status = 'pending'`, [managerId]
      );
      pendingLeaves = plRes?.pendingLeaves || 0;

      const [plr] = await db.query(
        `SELECT lr.id, CONCAT(e.first_name,' ',e.last_name) as employee_name,
                lt.name as leave_type_name, lr.start_date, lr.end_date, lr.days, lr.reason, lr.status
         FROM leave_requests lr
         JOIN employees e ON lr.employee_id = e.id
         JOIN leave_types lt ON lr.leave_type_id = lt.id
         WHERE e.manager_id = ? AND lr.status = 'pending' ORDER BY lr.created_at DESC`, [managerId]
      );
      pendingLeaveRequests = plr || [];

      const [tt] = await db.query(
        `SELECT t.*, CONCAT(e.first_name,' ',e.last_name) as assigned_name, u.name as assigned_by_name
         FROM tasks t
         LEFT JOIN employees e ON t.assigned_to = e.id
         LEFT JOIN users u ON t.created_by = u.id
         WHERE (e.manager_id = ? OR t.created_by = ?)
         ORDER BY t.created_at DESC LIMIT 10`,
        [managerId, req.user.id]
      );
      teamTasks = tt || [];

      const [[ptkRes]] = await db.query(
        `SELECT
          COALESCE(SUM(t.status IN ('todo','in_progress')), 0) as pendingTasks,
          COALESCE(SUM(t.status != 'completed' AND t.due_date < CURDATE()), 0) as overdueTasks
         FROM tasks t
         LEFT JOIN employees e ON t.assigned_to = e.id
         WHERE (e.manager_id = ? OR t.created_by = ?)`,
        [managerId, req.user.id]
      );
      pendingTasks = ptkRes?.pendingTasks || 0;
      overdueTasks = ptkRes?.overdueTasks || 0;

      const [tp] = await db.query(
        `SELECT pr.*, CONCAT(e.first_name,' ',e.last_name) as employee_name
         FROM performance_reviews pr
         JOIN employees e ON pr.employee_id = e.id
         WHERE e.manager_id = ? ORDER BY pr.created_at DESC LIMIT 5`, [managerId]
      );
      teamPerformance = tp || [];
    }

    const [notifications] = await db.query(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`, [req.user.id]
    );

    const [upcomingHolidays] = await db.query(
      `SELECT name, date, type FROM holidays WHERE date >= CURDATE() ORDER BY date ASC LIMIT 5`
    );

    return successResponse(res, {
      teamSize,
      presentToday,
      absentToday: Math.max(0, absentToday),
      teamAttendance,
      pendingLeaves,
      pendingLeaveRequests,
      teamTasks,
      pendingTasks,
      overdueTasks,
      teamPerformance,
      notifications: notifications || [],
      upcomingHolidays: upcomingHolidays || []
    });
  } catch (err) {
    console.error('Manager dashboard error:', err);
    return errorResponse(res, 'Failed to load manager dashboard', 500);
  }
}

export async function getEmployeeDashboard(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();

    const [empRows] = await db.query(
      `SELECT e.*, d.name as department_name, des.name as designation_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       WHERE e.user_id = ?`, [req.user.id]
    );
    const profile = empRows[0] || null;
    const empId = profile?.id || null;

    let todayAttendance = null;
    let leaveBalances = [];
    let pendingLeaveRequests = [];
    let myTasks = [];
    let upcomingTaskDeadlines = [];
    let performanceSummary = null;
    let latestPayslip = null;

    if (empId) {
      const [[att]] = await db.query(
        `SELECT * FROM attendance WHERE employee_id = ? AND date = ?`, [empId, today]
      );
      todayAttendance = att || null;

      const [lb] = await db.query(
        `SELECT lt.name as leave_type_name, lb.total_days, lb.used_days, lb.remaining_days
         FROM leave_balances lb JOIN leave_types lt ON lb.leave_type_id = lt.id
         WHERE lb.employee_id = ? AND lb.year = ?`, [empId, currentYear]
      );
      leaveBalances = lb || [];

      const [plr] = await db.query(
        `SELECT lr.*, lt.name as leave_type_name
         FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id = lt.id
         WHERE lr.employee_id = ? AND lr.status = 'pending' ORDER BY lr.created_at DESC`, [empId]
      );
      pendingLeaveRequests = plr || [];

      const [tasks] = await db.query(
        `SELECT t.*, u.name as assigned_by_name
         FROM tasks t
         LEFT JOIN users u ON t.created_by = u.id
         WHERE t.assigned_to = ?
         ORDER BY t.created_at DESC LIMIT 10`, [empId]
      );
      myTasks = tasks || [];

      const [deadlines] = await db.query(
        `SELECT t.*, u.name as assigned_by_name
         FROM tasks t
         LEFT JOIN users u ON t.created_by = u.id
         WHERE t.assigned_to = ? AND t.status IN ('todo','in_progress') AND t.due_date >= CURDATE()
         ORDER BY t.due_date ASC LIMIT 5`, [empId]
      );
      upcomingTaskDeadlines = deadlines || [];

      const [[perf]] = await db.query(
        `SELECT * FROM performance_reviews WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1`, [empId]
      );
      performanceSummary = perf || null;

      const [[payslip]] = await db.query(
        `SELECT * FROM payroll WHERE employee_id = ? AND status IN ('processed','paid') ORDER BY year DESC, month DESC LIMIT 1`, [empId]
      );
      latestPayslip = payslip || null;
    }

    const [upcomingHolidays] = await db.query(
      `SELECT name, date, type FROM holidays WHERE date >= CURDATE() ORDER BY date ASC LIMIT 5`
    );

    const [notifications] = await db.query(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`, [req.user.id]
    );

    const [[notifRes]] = await db.query(
      `SELECT COUNT(*) as unreadNotifications FROM notifications WHERE user_id = ? AND is_read = 0`,
      [req.user.id]
    );

    return successResponse(res, {
      profile,
      todayAttendance,
      leaveBalances,
      pendingLeaveRequests,
      myTasks,
      upcomingTaskDeadlines,
      performanceSummary,
      latestNotifications: notifications || [],
      unreadNotifications: notifRes?.unreadNotifications || 0,
      upcomingHolidays: upcomingHolidays || [],
      latestPayslip
    });
  } catch (err) {
    console.error('Employee dashboard error:', err);
    return errorResponse(res, 'Failed to load employee dashboard', 500);
  }
}
