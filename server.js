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
const dbOptions = { host: '37.27.71.198', user: 'ngyesawv_user', password: 'rahulB123@', database: 'ngyesawv_chatx' };
const pool = mysql.createPool(dbOptions);
const sessionStore = new MySQLStore(dbOptions);

const sessionMiddleware = session({
    key: 'chatx_session', secret: 'chatx_secret_key_99', store: sessionStore,
    resave: false, saveUninitialized: false, cookie: { maxAge: 1000 * 60 * 60 * 24 * 30, httpOnly: true }
});

app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Update Last Seen on every request
app.use(async (req, res, next) => {
    if (req.session.userId) await pool.query('UPDATE users SET last_seen = NOW() WHERE id = ?', [req.session.userId]);
    next();
});

// --- ROUTES ---
app.get('/', (req, res) => res.redirect(req.session.userId ? '/chat' : '/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/chat', (req, res) => req.session.userId ? res.sendFile(path.join(__dirname, 'public', 'index.html')) : res.redirect('/login'));

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (users.length && await bcrypt.compare(password, users[0].password)) {
        if (users[0].is_approved) {
            req.session.userId = users[0].id; req.session.isAdmin = users[0].is_admin;
            res.redirect('/chat');
        } else res.send("Pending approval.");
    } else res.send("Invalid login.");
});

// ADD USER
app.post('/add-contact', async (req, res) => {
    const { phone } = req.body;
    const [target] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (target.length) {
        await pool.query('INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)', [req.session.userId, target[0].id]);
        res.sendStatus(200);
    } else res.status(404).send("Not found");
});

// GET CONTACTS (SORTED BY LATEST MESSAGE)
app.get('/my-contacts', async (req, res) => {
    const myId = req.session.userId;
    const [contacts] = await pool.query(`
        SELECT u.id, u.profile_name, u.last_seen, c.last_chat_time,
        (SELECT COUNT(*) FROM direct_messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count,
        (SELECT message FROM direct_messages WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY created_at DESC LIMIT 1) as last_msg
        FROM users u 
        JOIN contacts c ON u.id = c.contact_id 
        WHERE c.user_id = ? 
        ORDER BY c.last_chat_time DESC`, [myId, myId, myId, myId, myId]);
    res.json(contacts);
});

// GET MESSAGES WITH DATE FILTER
app.get('/messages/:contactId', async (req, res) => {
    const myId = req.session.userId;
    const contactId = req.params.contactId;
    const { from, to } = req.query;
    
    await pool.query("UPDATE direct_messages SET is_read = 1, status = 'read' WHERE sender_id = ? AND receiver_id = ?", [contactId, myId]);
    
    let query = `SELECT sender_id, message, created_at, status FROM direct_messages WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`;
    let params = [myId, contactId, contactId, myId];
    if (from && to) { query += ` AND created_at BETWEEN ? AND ?`; params.push(`${from} 00:00:00`, `${to} 23:59:59`); }
    query += ` ORDER BY created_at ASC`;

    const [msgs] = await pool.query(query, params);
    const [user] = await pool.query('SELECT profile_name, last_seen FROM users WHERE id = ?', [contactId]);
    res.json({ messages: msgs, contact: user[0] });
});

// --- SOCKET.IO ---
io.engine.use(sessionMiddleware);
io.on('connection', (socket) => {
    const userId = socket.request.session.userId;
    if (!userId) return;
    socket.join(`user_${userId}`);

    socket.on('typing', (d) => io.to(`user_${d.toId}`).emit('is-typing', { fromId: userId }));
    socket.on('stop-typing', (d) => io.to(`user_${d.toId}`).emit('not-typing', { fromId: userId }));

    socket.on('send-message', async (data, callback) => {
        await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message, status) VALUES (?, ?, ?, "sent")', [userId, data.toId, data.text]);
        await pool.query('UPDATE contacts SET last_chat_time = NOW() WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)', [userId, data.toId, data.toId, userId]);
        await pool.query('INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)', [data.toId, userId]);
        io.to(`user_${data.toId}`).emit('receive-message', { fromId: userId, text: data.text });
        callback({ success: true });
    });
});

server.listen(process.env.PORT || 3000);
