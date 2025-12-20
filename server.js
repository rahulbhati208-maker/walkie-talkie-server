const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- DB CONFIG ---
const dbOptions = {
    host: '37.27.71.198', 
    user: 'ngyesawv_user', 
    password: 'rahulB123@', 
    database: 'ngyesawv_chatx'
};
const pool = mysql.createPool(dbOptions);
const sessionStore = new MySQLStore(dbOptions);

// --- MIDDLEWARE ---
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    key: 'whatsapp_session',
    secret: 'super_secret_key_123',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 } // 30 Days
}));

// --- ROUTES ---

// Registration
app.post('/register', async (req, res) => {
    const { phone, password, name } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    try {
        await pool.query('INSERT INTO users (phone, password, profile_name) VALUES (?, ?, ?)', [phone, hashed, name]);
        res.send("<h2>Registration Successful</h2><p>Wait for Admin approval before logging in.</p><a href='/login'>Go to Login</a>");
    } catch (e) { res.status(500).send("User already exists or DB Error."); }
});

// Login
app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    
    if (users.length && await bcrypt.compare(password, users[0].password)) {
        if (users[0].is_approved) {
            req.session.userId = users[0].id;
            req.session.isAdmin = users[0].is_admin;
            req.session.phone = users[0].phone;
            res.redirect('/chat');
        } else {
            res.send("<h2>Pending Approval</h2><p>Your account has not been approved by an admin yet.</p>");
        }
    } else {
        res.send("Invalid credentials. <a href='/login'>Try again</a>");
    }
});

// --- ADMIN DASHBOARD LOGIC ---
app.get('/admin', async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).send("Unauthorized");
    
    const [unapproved] = await pool.query('SELECT id, phone, profile_name FROM users WHERE is_approved = 0');
    
    let listHtml = unapproved.map(u => `
        <li>
            ${u.profile_name} (${u.phone}) 
            <a href="/admin/approve/${u.id}">[Approve]</a>
        </li>`).join('');

    res.send(`
        <h1>Admin Dashboard - Pending Users</h1>
        <ul>${listHtml || "No pending users"}</ul>
        <a href="/chat">Go to Chat</a>
    `);
});

app.get('/admin/approve/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).send("Unauthorized");
    await pool.query('UPDATE users SET is_approved = 1 WHERE id = ?', [req.params.id]);
    res.redirect('/admin');
});

// Chat Page (Protected)
app.get('/chat', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('register-socket', (phone) => {
        socket.join(phone); // Join a room named after their phone number
    });

    socket.on('send-message', async (data) => {
        // data = { toPhone, fromPhone, message }
        await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message) SELECT (SELECT id FROM users WHERE phone=?), (SELECT id FROM users WHERE phone=?), ?', 
        [data.fromPhone, data.toPhone, data.message]);
        
        // Send to the specific recipient
        io.to(data.toPhone).emit('receive-message', {
            from: data.fromPhone,
            text: data.message
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('WhatsApp Server running...'));
