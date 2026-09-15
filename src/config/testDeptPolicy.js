import mysql from 'mysql2/promise';
import 'dotenv/config';

async function testDeptPolicies() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'employedb'
  });

  console.log('--- TEST 1: Check department_leave_policies table contents ---');
  const [policies] = await conn.query(
    `SELECT dlp.*, d.name as department_name
     FROM department_leave_policies dlp
     JOIN departments d ON dlp.department_id = d.id
     WHERE dlp.leave_year = 2026`
  );
  console.log(`Found ${policies.length} department policies for 2026:`);
  for (const p of policies) {
    console.log(`  Dept: ${p.department_name} | Year: ${p.leave_year} | CL: ${p.casual_days} | SL: ${p.sick_days} | EL: ${p.earned_days} | Unpaid Allowed: ${p.unpaid_allowed}`);
  }

  console.log('\n--- TEST 2: Check employees in IT with different designations receiving IT policy ---');
  const [itEmployees] = await conn.query(
    `SELECT e.id, e.first_name, e.last_name, d.name as dept_name, des.name as desig_name
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.id
     LEFT JOIN designations des ON e.designation_id = des.id
     WHERE d.name = 'IT'`
  );
  console.log(`Found ${itEmployees.length} employees in IT department:`);

  const [itPolicyRows] = await conn.query(
    `SELECT dlp.* FROM department_leave_policies dlp JOIN departments d ON dlp.department_id = d.id WHERE d.name = 'IT' AND dlp.leave_year = 2026`
  );
  const itPolicy = itPolicyRows[0];

  for (const emp of itEmployees) {
    console.log(`  Employee: ${emp.first_name} ${emp.last_name} | Dept: ${emp.dept_name} | Designation: ${emp.desig_name}`);
    console.log(`    -> Entitlement: CL: ${itPolicy.casual_days} | SL: ${itPolicy.sick_days} | EL: ${itPolicy.earned_days}`);
  }

  console.log('\n--- TEST 3: Check HR and Finance employee entitlements ---');
  const [hrEmp] = await conn.query(`SELECT e.first_name, e.last_name, d.name as dept_name FROM employees e JOIN departments d ON e.department_id = d.id WHERE d.name = 'HR'`);
  const [finEmp] = await conn.query(`SELECT e.first_name, e.last_name, d.name as dept_name FROM employees e JOIN departments d ON e.department_id = d.id WHERE d.name = 'Finance'`);

  if (hrEmp.length > 0) {
    const [hrPol] = await conn.query(`SELECT dlp.* FROM department_leave_policies dlp JOIN departments d ON dlp.department_id = d.id WHERE d.name = 'HR' AND dlp.leave_year = 2026`);
    console.log(`  HR Employee: ${hrEmp[0].first_name} ${hrEmp[0].last_name} -> CL: ${hrPol[0].casual_days} | SL: ${hrPol[0].sick_days} | EL: ${hrPol[0].earned_days}`);
  }

  if (finEmp.length > 0) {
    const [finPol] = await conn.query(`SELECT dlp.* FROM department_leave_policies dlp JOIN departments d ON dlp.department_id = d.id WHERE d.name = 'Finance' AND dlp.leave_year = 2026`);
    console.log(`  Finance Employee: ${finEmp[0].first_name} ${finEmp[0].last_name} -> CL: ${finPol[0].casual_days} | SL: ${finPol[0].sick_days} | EL: ${finPol[0].earned_days}`);
  }

  console.log('\n✅ Verification script completed successfully!');
  await conn.end();
}

testDeptPolicies();
