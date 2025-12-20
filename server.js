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

// --- DATABASE CONFIGURATION ---
const dbOptions = {
    host: '37.27.71.198', 
    user: 'ngyesawv_user', 
    password: 'rahulB123@', 
    database: 'ngyesawv_chatx'
};
const pool = mysql.createPool(dbOptions);
const sessionStore = new MySQLStore(dbOptions);

const sessionMiddleware = session({
    key: 'whatsapp_session',
    secret: 'super_secret_key_123',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 } // 30 Day Session
});

// --- MIDDLEWARE ---
app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// DO NOT use express.static for the main HTML files if you want clean URLs.
// We serve specific assets (CSS/JS/Images) from public, but route HTML manually.
app.use('/assets', express.static(path.join(__dirname, 'public')));

// --- CLEAN ROUTING (Fixes the .html issue) ---

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
    if (!req.session.isAdmin) return res.status(403).send("Access Denied: Admins Only");
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- AUTHENTICATION LOGIC ---

app.post('/register', async (req, res) => {
    const { phone, password, name } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (phone, password, profile_name) VALUES (?, ?, ?)', [phone, hashed, name]);
        res.send("<h2>Success!</h2><p>Wait for Admin approval.</p><a href='/login'>Go to Login</a>");
    } catch (e) {
        res.status(500).send("Registration failed. Number might already exist.");
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
                res.send("Your account is pending admin approval.");
            }
        } else {
            res.send("Invalid credentials. <a href='/login'>Try again</a>");
        }
    } catch (e) {
        res.status(500).send("Server error during login.");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// --- ADMIN API ---

app.get('/api/admin/pending', async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json([]);
    const [unapproved] = await pool.query('SELECT id, phone, profile_name FROM users WHERE is_approved = 0');
    res.json(unapproved);
});

app.get('/admin/approve/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).send("Forbidden");
    await pool.query('UPDATE users SET is_approved = 1 WHERE id = ?', [req.params.id]);
    res.sendStatus(200);
});

// --- CONTACTS & CHAT HISTORY ---

app.post('/add-contact', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { phone } = req.body;
    try {
        const [target] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
        if (target.length) {
            await pool.query('INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)', [req.session.userId, target[0].id]);
        }
        res.redirect('/chat');
    } catch (e) { res.redirect('/chat'); }
});

app.get('/my-contacts', async (req, res) => {
    if (!req.session.userId) return res.json([]);
    const [contacts] = await pool.query(`
        SELECT u.id, u.phone, u.profile_name 
        FROM users u 
        JOIN contacts c ON u.id = c.contact_id 
        WHERE c.user_id = ?`, [req.session.userId]);
    res.json(contacts);
});

app.get('/messages/:contactId', async (req, res) => {
    const myId = req.session.userId;
    const contactId = req.params.contactId;
    const [msgs] = await pool.query(`
        SELECT sender_id, message FROM direct_messages 
        WHERE (sender_id = ? AND receiver_id = ?) 
        OR (sender_id = ? AND receiver_id = ?) 
        ORDER BY created_at ASC`, [myId, contactId, contactId, myId]);
    res.json(msgs);
});

// --- SOCKET.IO REAL-TIME LOGIC ---

io.engine.use(sessionMiddleware);

io.on('connection', (socket) => {
    const userId = socket.request.session.userId;
    if (!userId) return socket.disconnect();

    socket.join(`user_${userId}`);

    socket.on('send-message', async (data) => {
        const { toId, text } = data;
        await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message) VALUES (?, ?, ?)', [userId, toId, text]);
        
        io.to(`user_${toId}`).emit('receive-message', {
            fromId: userId,
            text: text
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
