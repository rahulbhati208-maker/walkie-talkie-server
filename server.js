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

// --- DATABASE CONFIG ---
const dbOptions = {
    host: '37.27.71.198', 
    user: 'ngyesawv_user', 
    password: 'rahulB123@', 
    database: 'ngyesawv_chatx'
};

const pool = mysql.createPool(dbOptions);
const sessionStore = new MySQLStore(dbOptions);

const sessionMiddleware = session({
    key: 'chatx_session',
    secret: 'chatx_ultra_secret_8899',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 Days persistence
        httpOnly: true 
    }
});

// --- MIDDLEWARE ---
app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// Serve static assets from public, but route HTML manually for clean URLs
app.use('/assets', express.static(path.join(__dirname, 'public')));

// --- PAGE ROUTING ---

app.get('/', (req, res) => {
    if (req.session.userId) res.redirect('/chat');
    else res.redirect('/login');
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/chat', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    if (!req.session.isAdmin) return res.status(403).send("Unauthorized: Admin Access Only");
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- AUTHENTICATION LOGIC ---

app.post('/register', async (req, res) => {
    const { phone, password, name } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        // Force is_approved to 0 so they appear in Admin Panel
        await pool.query(
            'INSERT INTO users (phone, password, profile_name, is_approved) VALUES (?, ?, ?, 0)', 
            [phone, hashed, name]
        );
        res.send("<h2>Registration Success</h2><p>Wait for Admin approval.</p><a href='/login'>Login</a>");
    } catch (e) {
        res.status(500).send("User already exists or database error.");
    }
});

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
        if (users.length && await bcrypt.compare(password, users[0].password)) {
            if (users[0].is_approved) {
                req.session.userId = users[0].id;
                req.session.isAdmin = users[0].is_admin;
                req.session.userName = users[0].profile_name;
                res.redirect('/chat');
            } else {
                res.send("Account pending admin approval.");
            }
        } else {
            res.send("Invalid login credentials. <a href='/login'>Try again</a>");
        }
    } catch (e) {
        res.status(500).send("Server login error.");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// --- ADMIN API ---

app.get('/api/admin/pending', async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json([]);
    try {
        const [unapproved] = await pool.query('SELECT id, phone, profile_name FROM users WHERE is_approved = 0');
        res.json(unapproved);
    } catch (e) { res.status(500).json([]); }
});

app.get('/admin/approve/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).send("Forbidden");
    await pool.query('UPDATE users SET is_approved = 1 WHERE id = ?', [req.params.id]);
    res.sendStatus(200);
});

// --- CONTACTS & MESSAGING LOGIC ---

app.post('/add-contact', async (req, res) => {
    if (!req.session.userId) return res.status(401).send("Login required");
    const { phone } = req.body;
    try {
        const [target] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
        if (target.length) {
            await pool.query('INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)', [req.session.userId, target[0].id]);
            res.sendStatus(200);
        } else {
            res.status(404).send("User not found");
        }
    } catch (e) { res.status(500).send("DB Error"); }
});

app.get('/my-contacts', async (req, res) => {
    if (!req.session.userId) return res.json([]);
    const myId = req.session.userId;
    try {
        const [contacts] = await pool.query(`
            SELECT u.id, u.phone, u.profile_name,
            (SELECT COUNT(*) FROM direct_messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
            FROM users u 
            JOIN contacts c ON u.id = c.contact_id 
            WHERE c.user_id = ?`, [myId, myId]);
        res.json(contacts);
    } catch (err) { res.json([]); }
});

app.get('/messages/:contactId', async (req, res) => {
    const myId = req.session.userId;
    const contactId = req.params.contactId;
    try {
        // Automatically mark as read when chat is opened
        await pool.query('UPDATE direct_messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?', [contactId, myId]);

        const [msgs] = await pool.query(`
            SELECT sender_id, message, created_at FROM direct_messages 
            WHERE (sender_id = ? AND receiver_id = ?) 
            OR (sender_id = ? AND receiver_id = ?) 
            ORDER BY created_at ASC`, [myId, contactId, contactId, myId]);
        res.json(msgs);
    } catch (e) { res.json([]); }
});

// --- SOCKET.IO REAL-TIME ENGINE ---

io.engine.use(sessionMiddleware);

io.on('connection', (socket) => {
    const userId = socket.request.session.userId;
    if (!userId) return socket.disconnect();

    socket.join(`user_${userId}`);

    socket.on('send-message', async (data) => {
        const { toId, text } = data;
        try {
            // 1. Save message to DB
            await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message, is_read) VALUES (?, ?, ?, 0)', [userId, toId, text]);
            
            // 2. AUTO-ADD CONTACT: Ensure the recipient has the sender in their list so they see the message
            await pool.query('INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)', [toId, userId]);

            // 3. Emit real-time to the recipient's private room
            io.to(`user_${toId}`).emit('receive-message', {
                fromId: userId,
                text: text
            });
        } catch (e) { console.error("Socket Error:", e); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chat X running on port ${PORT}`));
