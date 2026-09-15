// import mysql from 'mysql2/promise';
// import 'dotenv/config';

// export let db;

// export async function testdbconnection() {
//     try {
//         // First connect to MySQL server
//         const connection = await mysql.createConnection({
//             host: process.env.DB_HOST,
//             port: process.env.DB_PORT,
//             user: process.env.DB_USER,
//             password: process.env.DB_PASSWORD
//         });

//         // Create database if it doesn't exist
//         await connection.query(
//             `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``
//         );

//         console.log(`Database '${process.env.DB_NAME}' is ready`);

//         await connection.end();

//         // Now create pool using the database
//         db = mysql.createPool({
//             host: process.env.DB_HOST,
//             port: process.env.DB_PORT,
//             user: process.env.DB_USER,
//             password: process.env.DB_PASSWORD,
//             database: process.env.DB_NAME
//         });

//         // Test database connection
//         const dbConnection = await db.getConnection();

//         console.log('My Sql Connected Successfully');

//         dbConnection.release();

//     } catch (error) {
//         console.error('My Sql connection Error', error);
//     }
// }


import mysql from 'mysql2/promise';
import 'dotenv/config';

export let db;

export async function testdbconnection() {
    try {
        db = mysql.createPool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            ssl: {
                ca: process.env.DB_SSL_CA,
                rejectUnauthorized: true
            }
        });

        const dbConnection = await db.getConnection();

        console.log('My Sql Connected Successfully');

        dbConnection.release();

    } catch (error) {
        console.error('My Sql connection Error', error);
    }
}