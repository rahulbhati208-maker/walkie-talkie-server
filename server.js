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
    database: 'ngyesawv_chatx',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbOptions);
const sessionStore = new MySQLStore(dbOptions);

const sessionMiddleware = session({
    key: 'chatx_session',
    secret: 'chatx_secret_key_99',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30, httpOnly: true }
});

// Middleware
app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Update Last Seen
app.use(async (req, res, next) => {
    if (req.session.userId) {
        try {
            await pool.query('UPDATE users SET last_seen = NOW() WHERE id = ?', [req.session.userId]);
        } catch (e) { console.error("LastSeen Error:", e.message); }
    }
    next();
});

// --- ROUTES ---
app.get('/', (req, res) => res.redirect(req.session.userId ? '/chat' : '/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/chat', (req, res) => req.session.userId ? res.sendFile(path.join(__dirname, 'public', 'index.html')) : res.redirect('/login'));

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
        if (users.length && await bcrypt.compare(password, users[0].password)) {
            if (users[0].is_approved) {
                req.session.userId = users[0].id;
                req.session.isAdmin = users[0].is_admin;
                req.session.save(() => res.redirect('/chat')); // Forced save before redirect
            } else res.send("Account pending approval.");
        } else res.send("Invalid credentials.");
    } catch (e) { res.status(500).send("Login DB Error"); }
});

app.get('/my-contacts', async (req, res) => {
    const myId = req.session.userId;
    if (!myId) return res.status(401).json([]);
    try {
        const [contacts] = await pool.query(`
            SELECT u.id, u.profile_name, u.last_seen, c.last_chat_time,
            (SELECT COUNT(*) FROM direct_messages WHERE sender_id = u.id AND receiver_id = ? AND status != 'read') as unread_count
            FROM users u 
            JOIN contacts c ON u.id = c.contact_id 
            WHERE c.user_id = ? 
            ORDER BY c.last_chat_time DESC`, [myId, myId]);
        res.json(contacts);
    } catch (e) { console.error(e); res.json([]); }
});

app.get('/messages/:contactId', async (req, res) => {
    const myId = req.session.userId;
    const contactId = req.params.contactId;
    if (!myId) return res.status(401).json({messages: []});

    try {
        await pool.query("UPDATE direct_messages SET status = 'read' WHERE sender_id = ? AND receiver_id = ?", [contactId, myId]);
        const [msgs] = await pool.query(`
            SELECT m.id, m.sender_id, m.message, m.created_at, m.status, r.message as reply_text 
            FROM direct_messages m 
            LEFT JOIN direct_messages r ON m.reply_to_id = r.id
            WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?) 
            ORDER BY m.created_at ASC`, [myId, contactId, contactId, myId]);
        
        const [user] = await pool.query('SELECT profile_name, last_seen FROM users WHERE id = ?', [contactId]);
        res.json({ messages: msgs, contact: user[0] });
    } catch (e) { res.json({messages: []}); }
});

// --- SOCKET.IO BRIDGE ---
io.engine.use(sessionMiddleware);

io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session || !session.userId) {
        console.log("Socket rejected: No Session");
        return socket.disconnect();
    }
    const userId = session.userId;
    socket.join(`user_${userId}`);

    socket.on('send-message', async (data, callback) => {
        try {
            const [result] = await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message, status, reply_to_id) VALUES (?, ?, ?, "sent", ?)', 
                [userId, data.toId, data.text, data.replyTo || null]);
            
            await pool.query('UPDATE contacts SET last_chat_time = NOW() WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)', 
                [userId, data.toId, data.toId, userId]);
            
            io.to(`user_${data.toId}`).emit('receive-message', { fromId: userId, text: data.text });
            if(callback) callback({ success: true, id: result.insertId });
        } catch (e) { if(callback) callback({ success: false }); }
    });

    socket.on('typing', (d) => io.to(`user_${d.toId}`).emit('is-typing', { fromId: userId }));
    socket.on('stop-typing', (d) => io.to(`user_${d.toId}`).emit('not-typing', { fromId: userId }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chat X live on port ${PORT}`));
