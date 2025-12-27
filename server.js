const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

// --- MIDDLEWARE ---
app.use(cors()); // Allow connection from anywhere
app.use(express.json()); // Parse JSON bodies (Raw)
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies (Retrofit @Field)

// --- DATABASE CONNECTION ---
// ⚠️ REPLACE THESE VALUES WITH YOUR NEW DATABASE CREDENTIALS IF NOT USING .ENV
const pool = mysql.createPool({
    host: process.env.DB_HOST || '37.27.71.198', 
    user: process.env.DB_USER || 'ngyesawv_user',
    password: process.env.DB_PASSWORD || 'rahulB123@',
    database: process.env.DB_NAME || 'ngyesawv_chatx',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const db = pool.promise();

// --- API ROUTES ---

// 1. Test Route (To check if server is running)
app.get('/', (req, res) => {
    res.send("Vidyarathee Server is Running...");
});

// 2. REGISTER API
app.post('/register', async (req, res) => {
    const { full_name, email, password } = req.body;

    if (!full_name || !email || !password) {
        return res.status(400).json({ status: 'error', message: 'All fields are required' });
    }

    try {
        // Check if user already exists
        const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ status: 'error', message: 'Email already registered' });
        }

        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert into DB
        await db.execute(
            'INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)',
            [full_name, email, hashedPassword]
        );

        res.json({ status: 'success', message: 'Registration Successful' });

    } catch (err) {
        console.error("Register Error:", err);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// 3. LOGIN API
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ status: 'error', message: 'All fields are required' });
    }

    try {
        // Find user
        const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);

        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const user = rows[0];

        // Check Password
        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            res.json({
                status: 'success',
                message: 'Login Successful',
                user_id: user.id,
                full_name: user.full_name,
                email: user.email
            });
        } else {
            res.status(401).json({ status: 'error', message: 'Invalid password' });
        }

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
