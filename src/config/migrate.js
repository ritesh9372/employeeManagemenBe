import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import 'dotenv/config';

async function migrate() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      multipleStatements: true
    });

    console.log('Connected to database. Running migrations...');

    // ─── Ensure users table has required columns ───────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin','hr','manager','employee') DEFAULT 'employee',
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Add missing columns to users if they exist already without them
    try { await conn.query(`ALTER TABLE users ADD COLUMN role ENUM('admin','hr','manager','employee') DEFAULT 'employee'`); } catch(e){}
    try { await conn.query(`ALTER TABLE users ADD COLUMN is_active TINYINT(1) DEFAULT 1`); } catch(e){}
    try { await conn.query(`ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`); } catch(e){}

    console.log('✔ users table ready');

    // ─── Departments ───────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        head_id INT NULL,
        status ENUM('active','inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('✔ departments table ready');

    // ─── Designations ──────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS designations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        department_id INT NULL,
        description TEXT,
        level INT DEFAULT 1,
        status ENUM('active','inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
      )
    `);
    console.log('✔ designations table ready');

    // ─── Employees ─────────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NULL UNIQUE,
        employee_code VARCHAR(20) NULL UNIQUE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        phone VARCHAR(20),
        dob DATE,
        gender ENUM('male','female','other'),
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(100),
        department_id INT NULL,
        designation_id INT NULL,
        manager_id INT NULL,
        joining_date DATE,
        employment_type ENUM('full_time','part_time','contract','intern') DEFAULT 'full_time',
        salary DECIMAL(12,2) DEFAULT 0,
        bank_account VARCHAR(50),
        bank_name VARCHAR(100),
        ifsc_code VARCHAR(20),
        profile_photo VARCHAR(255),
        status ENUM('active','inactive') DEFAULT 'active',
        emergency_contact VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
        FOREIGN KEY (designation_id) REFERENCES designations(id) ON DELETE SET NULL
      )
    `);
    // Add FK for manager_id separately (self-referential)
    try {
      await conn.query(`ALTER TABLE employees ADD CONSTRAINT fk_manager FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL`);
    } catch(e) {}
    console.log('✔ employees table ready');

    // ─── Attendance ────────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id INT NOT NULL,
        date DATE NOT NULL,
        check_in TIME,
        check_out TIME,
        working_hours DECIMAL(4,2),
        status ENUM('present','absent','late','half_day','leave') DEFAULT 'present',
        work_mode ENUM('Office', 'Work From Home', 'Hybrid') DEFAULT 'Office',
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_emp_date (employee_id, date),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      )
    `);
    try { await conn.query("ALTER TABLE attendance ADD COLUMN work_mode ENUM('Office', 'Work From Home', 'Hybrid') DEFAULT 'Office'"); } catch(e){}
    try { await conn.query("CREATE INDEX idx_att_emp_date ON attendance(employee_id, date)"); } catch(e){}
    try { await conn.query("CREATE INDEX idx_att_date ON attendance(date)"); } catch(e){}
    try { await conn.query("CREATE INDEX idx_emp_dept ON employees(department_id)"); } catch(e){}
    try { await conn.query("CREATE INDEX idx_emp_status ON employees(status)"); } catch(e){}
    console.log('✔ attendance table ready');

    // ─── Leave Types ───────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS leave_types (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL UNIQUE,
        days_allowed INT DEFAULT 0,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✔ leave_types table ready');

    // ─── Leave Requests ────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id INT NOT NULL,
        leave_type_id INT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        days DECIMAL(4,1) NOT NULL,
        is_half_day TINYINT(1) DEFAULT 0,
        reason TEXT,
        status ENUM('pending','approved','rejected','cancelled') DEFAULT 'pending',
        approved_by INT NULL,
        approved_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (leave_type_id) REFERENCES leave_types(id),
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    try { await conn.query('ALTER TABLE leave_requests MODIFY COLUMN days DECIMAL(4,1) NOT NULL'); } catch(e){}
    try { await conn.query('ALTER TABLE leave_requests ADD COLUMN is_half_day TINYINT(1) DEFAULT 0'); } catch(e){}
    console.log('✔ leave_requests table ready');

    // ─── Leave Balances ────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS leave_balances (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id INT NOT NULL,
        leave_type_id INT NOT NULL,
        year INT NOT NULL,
        total_days DECIMAL(5,1) DEFAULT 0,
        used_days DECIMAL(5,1) DEFAULT 0,
        remaining_days DECIMAL(5,1) DEFAULT 0,
        UNIQUE KEY unique_emp_leave_year (employee_id, leave_type_id, year),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (leave_type_id) REFERENCES leave_types(id)
      )
    `);
    try { await conn.query('ALTER TABLE leave_balances MODIFY COLUMN total_days DECIMAL(5,1) DEFAULT 0'); } catch(e){}
    try { await conn.query('ALTER TABLE leave_balances MODIFY COLUMN used_days DECIMAL(5,1) DEFAULT 0'); } catch(e){}
    try { await conn.query('ALTER TABLE leave_balances MODIFY COLUMN remaining_days DECIMAL(5,1) DEFAULT 0'); } catch(e){}
    console.log('✔ leave_balances table ready');

    // ─── Department Leave Policies ──────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS department_leave_policies (
        id INT PRIMARY KEY AUTO_INCREMENT,
        department_id INT NOT NULL,
        leave_year INT NOT NULL,
        casual_days DECIMAL(5,1) DEFAULT 12,
        sick_days DECIMAL(5,1) DEFAULT 10,
        earned_days DECIMAL(5,1) DEFAULT 15,
        unpaid_allowed TINYINT(1) DEFAULT 1,
        unpaid_days DECIMAL(5,1) DEFAULT 30,
        is_active TINYINT(1) DEFAULT 1,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_dept_year (department_id, leave_year),
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    console.log('✔ department_leave_policies table ready');

    // ─── Leave Policies ────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS leave_policies (
        id INT PRIMARY KEY AUTO_INCREMENT,
        policy_name VARCHAR(150) NOT NULL,
        scope_type ENUM('COMPANY', 'DEPARTMENT', 'DESIGNATION', 'DEPARTMENT_DESIGNATION', 'EMPLOYEE') NOT NULL,
        department_id INT NULL,
        designation_id INT NULL,
        employee_id INT NULL,
        leave_year INT NOT NULL,
        casual_days DECIMAL(5,1) DEFAULT 12,
        sick_days DECIMAL(5,1) DEFAULT 10,
        earned_days DECIMAL(5,1) DEFAULT 15,
        unpaid_days DECIMAL(5,1) DEFAULT 30,
        description TEXT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
        FOREIGN KEY (designation_id) REFERENCES designations(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    console.log('✔ leave_policies table ready');


    // ─── Payroll ───────────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS payroll (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id INT NOT NULL,
        month INT NOT NULL,
        year INT NOT NULL,
        basic DECIMAL(12,2) DEFAULT 0,
        hra DECIMAL(12,2) DEFAULT 0,
        allowances DECIMAL(12,2) DEFAULT 0,
        bonus DECIMAL(12,2) DEFAULT 0,
        gross_salary DECIMAL(12,2) DEFAULT 0,
        tax DECIMAL(12,2) DEFAULT 0,
        deductions DECIMAL(12,2) DEFAULT 0,
        net_salary DECIMAL(12,2) DEFAULT 0,
        status ENUM('draft','processed','paid') DEFAULT 'draft',
        paid_on DATE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_emp_month_year (employee_id, month, year),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      )
    `);
    console.log('✔ payroll table ready');

    // ─── Tasks ─────────────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        assigned_to INT NULL,
        department_id INT NULL,
        created_by INT NOT NULL,
        priority ENUM('low','medium','high','critical') DEFAULT 'medium',
        status ENUM('todo','in_progress','review','completed') DEFAULT 'todo',
        start_date DATE,
        due_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (assigned_to) REFERENCES employees(id) ON DELETE SET NULL,
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    console.log('✔ tasks table ready');

    // ─── Performance Reviews ───────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS performance_reviews (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id INT NOT NULL,
        reviewer_id INT NOT NULL,
        review_period VARCHAR(50),
        attendance_score TINYINT,
        productivity_score TINYINT,
        quality_score TINYINT,
        teamwork_score TINYINT,
        communication_score TINYINT,
        overall_rating DECIMAL(3,1),
        strengths TEXT,
        improvements TEXT,
        comments TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewer_id) REFERENCES users(id)
      )
    `);
    console.log('✔ performance_reviews table ready');

    // ─── Holidays ──────────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        description TEXT,
        type ENUM('public','company','optional') DEFAULT 'public',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✔ holidays table ready');

    // ─── Announcements ─────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        publish_date DATE,
        expiry_date DATE,
        target ENUM('all','department','employee') DEFAULT 'all',
        target_id INT NULL,
        created_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    console.log('✔ announcements table ready');

    // ─── Notifications ─────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        type VARCHAR(50) DEFAULT 'info',
        reference_id INT NULL,
        is_read TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('✔ notifications table ready');

    // ─── Audit Logs ────────────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NULL,
        action VARCHAR(100) NOT NULL,
        module VARCHAR(50),
        record_id INT NULL,
        description TEXT,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✔ audit_logs table ready');

    // ─── Employee Documents ────────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS employee_documents (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id INT NOT NULL,
        document_type VARCHAR(100),
        file_path VARCHAR(255),
        file_name VARCHAR(255),
        uploaded_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      )
    `);
    console.log('✔ employee_documents table ready');

    // ═══════════════════════════════════════════════════════════════════════
    // SEED DATA
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\nSeeding demo data...');

    // ─── Departments ───────────────────────────────────────────────────────
    const depts = ['IT', 'HR', 'Finance', 'Marketing', 'Sales', 'Operations'];
    const deptDescriptions = [
      'Information Technology & Software Development',
      'Human Resources & People Management',
      'Financial Planning & Accounting',
      'Marketing & Brand Management',
      'Sales & Business Development',
      'Operations & Process Management'
    ];
    const deptIds = {};
    for (let i = 0; i < depts.length; i++) {
      const [existing] = await conn.query('SELECT id FROM departments WHERE name = ?', [depts[i]]);
      if (existing.length === 0) {
        const [r] = await conn.query(
          'INSERT INTO departments (name, description) VALUES (?, ?)',
          [depts[i], deptDescriptions[i]]
        );
        deptIds[depts[i]] = r.insertId;
      } else {
        deptIds[depts[i]] = existing[0].id;
      }
    }
    console.log('✔ Departments seeded');

    // ─── Designations ──────────────────────────────────────────────────────
    const designationData = [
      { name: 'CTO', dept: 'IT', level: 5 },
      { name: 'COO', dept: 'Operations', level: 5 },
      { name: 'CEO', dept: 'Operations', level: 5 },
      { name: 'Senior Manager', dept: 'IT', level: 4 },
      { name: 'Manager', dept: 'IT', level: 4 },
      { name: 'Software Developer', dept: 'IT', level: 2 },
      { name: 'Software Engineer', dept: 'IT', level: 2 },
      { name: 'Senior Software Engineer', dept: 'IT', level: 3 },
      { name: 'Team Lead', dept: 'IT', level: 4 },
      { name: 'HR Executive', dept: 'HR', level: 2 },
      { name: 'HR Manager', dept: 'HR', level: 4 },
      { name: 'Finance Analyst', dept: 'Finance', level: 2 },
      { name: 'Finance Manager', dept: 'Finance', level: 4 },
      { name: 'Accountant', dept: 'Finance', level: 2 },
      { name: 'Marketing Executive', dept: 'Marketing', level: 2 },
      { name: 'Marketing Manager', dept: 'Marketing', level: 4 },
      { name: 'Sales Executive', dept: 'Sales', level: 2 },
      { name: 'Sales Manager', dept: 'Sales', level: 4 },
      { name: 'Operations Executive', dept: 'Operations', level: 2 },
      { name: 'Intern', dept: 'IT', level: 1 },
    ];
    const desigIds = {};
    for (const d of designationData) {
      const [existing] = await conn.query('SELECT id FROM designations WHERE name = ? AND department_id = ?', [d.name, deptIds[d.dept]]);
      if (existing.length === 0) {
        const [r] = await conn.query(
          'INSERT INTO designations (name, department_id, level) VALUES (?, ?, ?)',
          [d.name, deptIds[d.dept], d.level]
        );
        desigIds[d.name] = r.insertId;
      } else {
        desigIds[d.name] = existing[0].id;
      }
    }
    console.log('✔ Designations seeded');

    // ─── Users & Employees ─────────────────────────────────────────────────
    const usersToSeed = [
      { name: 'Admin User', email: 'admin@company.com', password: 'Admin@123', role: 'admin', emp: { first_name: 'Admin', last_name: 'User', dept: 'IT', desig: 'Team Lead', salary: 150000 } },
      { name: 'Sarah HR', email: 'hr@company.com', password: 'Hr@123', role: 'hr', emp: { first_name: 'Sarah', last_name: 'HR', dept: 'HR', desig: 'HR Manager', salary: 90000 } },
      { name: 'Mike Manager', email: 'manager@company.com', password: 'Manager@123', role: 'manager', emp: { first_name: 'Mike', last_name: 'Manager', dept: 'IT', desig: 'Team Lead', salary: 110000 } },
      { name: 'John Smith', email: 'john.smith@company.com', password: 'Emp@123', role: 'employee', emp: { first_name: 'John', last_name: 'Smith', dept: 'IT', desig: 'Software Engineer', salary: 75000 } },
      { name: 'Emma Wilson', email: 'emma.wilson@company.com', password: 'Emp@123', role: 'employee', emp: { first_name: 'Emma', last_name: 'Wilson', dept: 'IT', desig: 'Senior Software Engineer', salary: 95000 } },
      { name: 'Robert Brown', email: 'robert.brown@company.com', password: 'Emp@123', role: 'employee', emp: { first_name: 'Robert', last_name: 'Brown', dept: 'Finance', desig: 'Finance Analyst', salary: 70000 } },
      { name: 'Lisa Davis', email: 'lisa.davis@company.com', password: 'Emp@123', role: 'employee', emp: { first_name: 'Lisa', last_name: 'Davis', dept: 'Marketing', desig: 'Marketing Executive', salary: 65000 } },
      { name: 'David Jones', email: 'david.jones@company.com', password: 'Emp@123', role: 'employee', emp: { first_name: 'David', last_name: 'Jones', dept: 'Sales', desig: 'Sales Executive', salary: 68000 } },
    ];

    const userIds = {};
    const empIds = {};
    let empCodeCounter = 1;

    for (const u of usersToSeed) {
      let userId;
      const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [u.email]);
      if (existing.length === 0) {
        const hashed = await bcrypt.hash(u.password, 10);
        const [r] = await conn.query(
          'INSERT INTO users (name, email, password, role, is_active) VALUES (?,?,?,?,1)',
          [u.name, u.email, hashed, u.role]
        );
        userId = r.insertId;
      } else {
        userId = existing[0].id;
        await conn.query('UPDATE users SET role = ? WHERE id = ?', [u.role, userId]);
      }
      userIds[u.email] = userId;

      const empCode = `EMP${String(empCodeCounter++).padStart(3, '0')}`;
      const [existingEmp] = await conn.query('SELECT id FROM employees WHERE email = ?', [u.email]);
      let empId;
      if (existingEmp.length === 0) {
        const [er] = await conn.query(
          `INSERT INTO employees (user_id, employee_code, first_name, last_name, email, phone, dob, gender,
            department_id, designation_id, joining_date, employment_type, salary, status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            userId, empCode, u.emp.first_name, u.emp.last_name, u.email,
            '98765' + String(Math.floor(10000 + Math.random() * 90000)),
            '1990-0' + (Math.floor(Math.random() * 9) + 1) + '-15',
            Math.random() > 0.5 ? 'male' : 'female',
            deptIds[u.emp.dept], desigIds[u.emp.desig],
            '2023-01-15', 'full_time', u.emp.salary, 'active'
          ]
        );
        empId = er.insertId;
      } else {
        empId = existingEmp[0].id;
      }
      empIds[u.email] = empId;
    }

    // Set manager_id for IT employees
    try {
      const mgr = empIds['manager@company.com'];
      if (mgr) {
        await conn.query('UPDATE employees SET manager_id = ? WHERE email IN (?,?,?)',
          [mgr, 'john.smith@company.com', 'emma.wilson@company.com', 'admin@company.com']);
      }
    } catch(e) {}

    console.log('✔ Users & Employees seeded');

    // ─── Leave Types ───────────────────────────────────────────────────────
    const leaveTypes = [
      { name: 'Casual Leave', days: 12, desc: 'For personal reasons and casual purposes' },
      { name: 'Sick Leave', days: 10, desc: 'For illness and medical reasons' },
      { name: 'Earned Leave', days: 15, desc: 'Annual earned leave entitlement' },
      { name: 'Unpaid Leave', days: 30, desc: 'Leave without pay' },
    ];
    const leaveTypeIds = {};
    for (const lt of leaveTypes) {
      const [existing] = await conn.query('SELECT id FROM leave_types WHERE name = ?', [lt.name]);
      if (existing.length === 0) {
        const [r] = await conn.query('INSERT INTO leave_types (name, days_allowed, description) VALUES (?,?,?)', [lt.name, lt.days, lt.desc]);
        leaveTypeIds[lt.name] = r.insertId;
      } else {
        leaveTypeIds[lt.name] = existing[0].id;
      }
    }
    console.log('✔ Leave types seeded');

    // ─── Leave Balances ────────────────────────────────────────────────────
    const currentYear = new Date().getFullYear();
    for (const email of Object.keys(empIds)) {
      const empId = empIds[email];
      for (const lt of leaveTypes) {
        const ltId = leaveTypeIds[lt.name];
        const used = Math.floor(Math.random() * 4);
        try {
          await conn.query(
            `INSERT IGNORE INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, remaining_days)
             VALUES (?,?,?,?,?,?)`,
            [empId, ltId, currentYear, lt.days, used, lt.days - used]
          );
        } catch(e) {}
      }
    }
    console.log('✔ Leave balances seeded');

    // ─── Attendance (last 30 days) ─────────────────────────────────────────
    const statuses = ['present', 'present', 'present', 'present', 'present', 'present', 'late', 'absent'];
    for (const email of Object.keys(empIds)) {
      const empId = empIds[email];
      for (let d = 30; d >= 1; d--) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue; // skip weekends
        const dateStr = date.toISOString().split('T')[0];
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        const checkIn = status === 'late' ? '10:15:00' : (status === 'absent' ? null : '09:00:00');
        const checkOut = (status === 'absent') ? null : '18:00:00';
        const hrs = status === 'absent' ? null : (status === 'late' ? 7.75 : 9.0);
        try {
          await conn.query(
            `INSERT IGNORE INTO attendance (employee_id, date, check_in, check_out, working_hours, status)
             VALUES (?,?,?,?,?,?)`,
            [empId, dateStr, checkIn, checkOut, hrs, status]
          );
        } catch(e) {}
      }
    }
    console.log('✔ Attendance seeded');

    // ─── Payroll (last 3 months) ───────────────────────────────────────────
    for (const email of Object.keys(empIds)) {
      const empId = empIds[email];
      const [empRow] = await conn.query('SELECT salary FROM employees WHERE id = ?', [empId]);
      const baseSalary = parseFloat(empRow[0]?.salary || 50000);
      for (let m = 3; m >= 1; m--) {
        const d = new Date();
        d.setMonth(d.getMonth() - m);
        const month = d.getMonth() + 1;
        const year = d.getFullYear();
        const basic = Math.round(baseSalary * 0.5);
        const hra = Math.round(baseSalary * 0.2);
        const allowances = Math.round(baseSalary * 0.15);
        const bonus = m === 1 ? 5000 : 0;
        const gross = basic + hra + allowances + bonus;
        const tax = Math.round(gross * 0.1);
        const deductions = Math.round(gross * 0.02);
        const net = gross - tax - deductions;
        try {
          await conn.query(
            `INSERT IGNORE INTO payroll (employee_id, month, year, basic, hra, allowances, bonus, gross_salary, tax, deductions, net_salary, status, paid_on)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [empId, month, year, basic, hra, allowances, bonus, gross, tax, deductions, net, 'paid', `${year}-${String(month).padStart(2,'0')}-28`]
          );
        } catch(e) {}
      }
    }
    console.log('✔ Payroll seeded');

    // ─── Tasks ─────────────────────────────────────────────────────────────
    const adminUserId = userIds['admin@company.com'];
    const mgrUserId = userIds['manager@company.com'];
    const tasks = [
      { title: 'Setup CI/CD Pipeline', desc: 'Configure GitHub Actions for automated deployment', assignee: empIds['john.smith@company.com'], dept: deptIds['IT'], priority: 'high', status: 'in_progress', due: '2026-10-15' },
      { title: 'Update Employee Handbook', desc: 'Review and update the company employee handbook for 2026', assignee: empIds['hr@company.com'], dept: deptIds['HR'], priority: 'medium', status: 'todo', due: '2026-10-30' },
      { title: 'Q3 Financial Report', desc: 'Prepare Q3 financial analysis and summary report', assignee: empIds['robert.brown@company.com'], dept: deptIds['Finance'], priority: 'critical', status: 'review', due: '2026-09-30' },
      { title: 'Launch Marketing Campaign', desc: 'Execute Q4 digital marketing campaign', assignee: empIds['lisa.davis@company.com'], dept: deptIds['Marketing'], priority: 'high', status: 'todo', due: '2026-10-01' },
      { title: 'Code Review - Payment Module', desc: 'Review and approve the payment gateway integration PR', assignee: empIds['emma.wilson@company.com'], dept: deptIds['IT'], priority: 'high', status: 'completed', due: '2026-09-10' },
      { title: 'Sales Target Q4', desc: 'Achieve Q4 sales targets as per the annual plan', assignee: empIds['david.jones@company.com'], dept: deptIds['Sales'], priority: 'high', status: 'in_progress', due: '2026-12-31' },
    ];
    for (const t of tasks) {
      try {
        await conn.query(
          `INSERT INTO tasks (title, description, assigned_to, department_id, created_by, priority, status, start_date, due_date)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [t.title, t.desc, t.assignee, t.dept, adminUserId, t.priority, t.status, '2026-09-01', t.due]
        );
      } catch(e) {}
    }
    console.log('✔ Tasks seeded');

    // ─── Performance Reviews ───────────────────────────────────────────────
    const reviewees = ['john.smith@company.com', 'emma.wilson@company.com', 'robert.brown@company.com', 'lisa.davis@company.com'];
    for (const email of reviewees) {
      const empId = empIds[email];
      if (!empId) continue;
      const a = Math.floor(Math.random() * 2) + 3;
      const p = Math.floor(Math.random() * 2) + 3;
      const q = Math.floor(Math.random() * 2) + 3;
      const t = Math.floor(Math.random() * 2) + 3;
      const c = Math.floor(Math.random() * 2) + 3;
      const overall = ((a + p + q + t + c) / 5).toFixed(1);
      try {
        await conn.query(
          `INSERT INTO performance_reviews (employee_id, reviewer_id, review_period, attendance_score, productivity_score, quality_score, teamwork_score, communication_score, overall_rating, strengths, improvements, comments)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [empId, mgrUserId, 'Q3 2026', a, p, q, t, c, overall, 'Strong technical skills, reliable', 'Communication can improve', 'Overall good performance this quarter']
        );
      } catch(e) {}
    }
    console.log('✔ Performance reviews seeded');

    // ─── Holidays ──────────────────────────────────────────────────────────
    const holidays = [
      { name: 'Gandhi Jayanti', date: '2026-10-02', type: 'public', desc: 'National holiday' },
      { name: 'Dussehra', date: '2026-10-12', type: 'public', desc: 'Festival of Vijayadashami' },
      { name: 'Diwali', date: '2026-11-01', type: 'public', desc: 'Festival of Lights' },
      { name: 'Diwali Holiday', date: '2026-11-02', type: 'company', desc: 'Company holiday for Diwali' },
      { name: 'Christmas', date: '2026-12-25', type: 'public', desc: 'Christmas Day' },
      { name: 'New Year', date: '2027-01-01', type: 'public', desc: "New Year's Day" },
      { name: 'Republic Day', date: '2027-01-26', type: 'public', desc: 'National holiday' },
      { name: 'Holi', date: '2027-03-01', type: 'public', desc: 'Festival of Colors' },
      { name: 'Company Foundation Day', date: '2026-11-15', type: 'company', desc: 'Company anniversary' },
      { name: 'Independence Day', date: '2026-08-15', type: 'public', desc: 'National holiday' },
    ];
    for (const h of holidays) {
      try {
        await conn.query('INSERT IGNORE INTO holidays (name, date, description, type) VALUES (?,?,?,?)',
          [h.name, h.date, h.desc, h.type]);
      } catch(e) {}
    }
    console.log('✔ Holidays seeded');

    // ─── Announcements ─────────────────────────────────────────────────────
    try {
      await conn.query(
        `INSERT INTO announcements (title, description, publish_date, expiry_date, target, created_by) VALUES
        ('Q4 Performance Review Cycle', 'The Q4 performance review cycle will begin on October 1st. All managers should schedule 1:1 meetings with their team members.', '2026-09-01', '2026-10-15', 'all', ?),
        ('Office Diwali Celebration', 'We will be celebrating Diwali on November 1st. Please join us for sweets, decorations and team bonding.', '2026-10-15', '2026-11-02', 'all', ?),
        ('IT Department Training', 'Mandatory AWS certification training for IT department from October 10-12. Please block your calendars.', '2026-09-10', '2026-10-13', 'department', ?)`,
        [adminUserId, adminUserId, adminUserId]
      );
    } catch(e) {}
    console.log('✔ Announcements seeded');

    // ─── Notifications ─────────────────────────────────────────────────────
    for (const email of Object.keys(userIds)) {
      const uid = userIds[email];
      try {
        await conn.query(
          `INSERT INTO notifications (user_id, title, message, type, is_read) VALUES
          (?, 'Welcome to EMS', 'Welcome to the Employee Management System. Your account is ready.', 'info', 0),
          (?, 'Q4 Review Started', 'The Q4 performance review cycle has started. Check your dashboard.', 'announcement', 0)`,
          [uid, uid]
        );
      } catch(e) {}
    }
    console.log('✔ Notifications seeded');

    // ─── Leave Requests (sample) ───────────────────────────────────────────
    try {
      const empId1 = empIds['john.smith@company.com'];
      const empId2 = empIds['emma.wilson@company.com'];
      const ltCasual = leaveTypeIds['Casual Leave'];
      const ltSick = leaveTypeIds['Sick Leave'];
      if (empId1 && ltCasual) {
        await conn.query(
          `INSERT IGNORE INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, status) VALUES
          (?, ?, '2026-10-05', '2026-10-06', 2, 'Personal work', 'pending'),
          (?, ?, '2026-09-01', '2026-09-02', 2, 'Sick - fever', 'approved')`,
          [empId1, ltCasual, empId1, ltSick]
        );
      }
      if (empId2 && ltSick) {
        await conn.query(
          `INSERT IGNORE INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, status) VALUES
          (?, ?, '2026-10-10', '2026-10-12', 3, 'Medical checkup', 'pending')`,
          [empId2, ltSick]
        );
      }
    } catch(e) {}
    console.log('✔ Leave requests seeded');

    // ─── Department Leave Policies (sample) ─────────────────────────────────
    try {
      const yr = currentYear;
      const deptPolicyData = [
        { deptName: 'IT', c: 12, s: 10, e: 15, u: 1 },
        { deptName: 'HR', c: 15, s: 12, e: 18, u: 1 },
        { deptName: 'Finance', c: 12, s: 12, e: 15, u: 1 },
        { deptName: 'Sales', c: 15, s: 10, e: 12, u: 1 },
        { deptName: 'Marketing', c: 12, s: 10, e: 15, u: 1 },
        { deptName: 'Operations', c: 12, s: 10, e: 15, u: 1 }
      ];

      for (const dp of deptPolicyData) {
        const dId = deptIds[dp.deptName];
        if (!dId) continue;
        const [exist] = await conn.query('SELECT id FROM department_leave_policies WHERE department_id = ? AND leave_year = ?', [dId, yr]);
        if (exist.length === 0) {
          await conn.query(
            `INSERT INTO department_leave_policies (department_id, leave_year, casual_days, sick_days, earned_days, unpaid_allowed, unpaid_days, is_active, created_by)
             VALUES (?,?,?,?,?,?,30,1,?)`,
            [dId, yr, dp.c, dp.s, dp.e, dp.u, adminUserId]
          );
        }
      }
    } catch(e) {}
    console.log('✔ Department leave policies seeded');

    // ─── Leave Policies (sample) ───────────────────────────────────────────
    try {
      const yr = currentYear;
      const ctoDesig = desigIds['CTO'];
      const cooDesig = desigIds['COO'];
      const srMgrDesig = desigIds['Senior Manager'];
      const mgrDesig = desigIds['Manager'] || desigIds['Team Lead'];
      const devDesig = desigIds['Software Developer'] || desigIds['Software Engineer'];
      const internDesig = desigIds['Intern'];
      const empJohnId = empIds['john.smith@company.com'];

      const demoPolicies = [
        { name: 'Company Default Policy', scope: 'COMPANY', dept: null, desig: null, emp: null, c: 12, s: 10, e: 15, u: 30 },
        { name: 'CTO Leave Policy', scope: 'DESIGNATION', dept: null, desig: ctoDesig, emp: null, c: 20, s: 15, e: 30, u: 30 },
        { name: 'COO Leave Policy', scope: 'DESIGNATION', dept: null, desig: cooDesig, emp: null, c: 20, s: 15, e: 30, u: 30 },
        { name: 'Senior Manager Leave Policy', scope: 'DESIGNATION', dept: null, desig: srMgrDesig, emp: null, c: 18, s: 15, e: 25, u: 30 },
        { name: 'Manager Leave Policy', scope: 'DESIGNATION', dept: null, desig: mgrDesig, emp: null, c: 15, s: 12, e: 20, u: 30 },
        { name: 'Software Developer Leave Policy', scope: 'DESIGNATION', dept: null, desig: devDesig, emp: null, c: 12, s: 10, e: 15, u: 30 },
        { name: 'Intern Leave Policy', scope: 'DESIGNATION', dept: null, desig: internDesig, emp: null, c: 5, s: 5, e: 0, u: 30 },
        { name: 'Special Executive Agreement for John Smith', scope: 'EMPLOYEE', dept: null, desig: null, emp: empJohnId, c: 18, s: 15, e: 25, u: 30 }
      ];

      for (const p of demoPolicies) {
        if (!p.desig && !p.emp && p.scope !== 'COMPANY') continue;
        const [exist] = await conn.query('SELECT id FROM leave_policies WHERE policy_name = ? AND leave_year = ?', [p.name, yr]);
        if (exist.length === 0) {
          await conn.query(
            `INSERT INTO leave_policies (policy_name, scope_type, department_id, designation_id, employee_id, leave_year, casual_days, sick_days, earned_days, unpaid_days, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [p.name, p.scope, p.dept, p.desig, p.emp, yr, p.c, p.s, p.e, p.u, adminUserId]
          );
        }
      }
    } catch(e) {}
    console.log('✔ Leave policies seeded');


    console.log('\n✅ Migration completed successfully!');
    console.log('\nDemo credentials:');
    console.log('  Admin:    admin@company.com    / Admin@123');
    console.log('  HR:       hr@company.com       / Hr@123');
    console.log('  Manager:  manager@company.com  / Manager@123');
    console.log('  Employee: john.smith@company.com / Emp@123');

  } catch (err) {
    console.error('Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

migrate();
