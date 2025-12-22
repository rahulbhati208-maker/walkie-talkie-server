const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const mysql = require('mysql2/promise');
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
    database: 'ngyesawv_chatx',
    waitForConnections: true,
    connectionLimit: 10
};

const pool = mysql.createPool(dbOptions);
const sessionStore = new MySQLStore(dbOptions);

app.use(session({
    key: 'chatx_session', secret: 'chatx_secret_key_99', store: sessionStore,
    resave: false, saveUninitialized: false, cookie: { maxAge: 1000 * 60 * 60 * 24 * 365 }
}));
app.use(express.static('public'));
app.use(express.json());

// --- AUTH MIDDLEWARE ---
const requireAuth = (req, res, next) => {
    if (!req.session.userId) return req.xhr ? res.status(401).json({}) : res.redirect('/login');
    next();
};

// --- ROUTES ---
app.get('/', requireAuth, (req, res) => res.redirect('/chat'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/chat', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
        // Note: Add bcrypt comparison here in production
        if (users.length && users[0].is_approved) {
            req.session.userId = users[0].id;
            req.session.save(() => res.redirect('/chat'));
        } else res.send("Invalid or Unapproved.");
    } catch (e) { res.status(500).send("Error"); }
});

// --- API: TOGGLE STAR ---
app.post('/api/star-message', requireAuth, async (req, res) => {
    const { msgId, isStarred } = req.body; // isStarred = 1 or 0
    await pool.query('UPDATE direct_messages SET is_starred = ? WHERE id = ?', [isStarred, msgId]);
    res.json({ success: true });
});

// --- API: MESSAGES WITH DATE FILTER ---
app.get('/messages/:contactId', requireAuth, async (req, res) => {
    const myId = req.session.userId;
    const contactId = req.params.contactId;
    const { from, to } = req.query;

    try {
        await pool.query("UPDATE direct_messages SET status = 'read' WHERE sender_id = ? AND receiver_id = ?", [contactId, myId]);

        let query = `
            SELECT m.id, m.sender_id, m.message, m.created_at, m.status, m.is_starred, r.message as reply_text 
            FROM direct_messages m 
            LEFT JOIN direct_messages r ON m.reply_to_id = r.id
            WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
        `;
        const params = [myId, contactId, contactId, myId];

        // FIX: Ensure full day coverage
        if (from && to) {
            query += ` AND m.created_at >= ? AND m.created_at <= ?`;
            params.push(`${from} 00:00:00`, `${to} 23:59:59`);
        }

        query += ` ORDER BY m.created_at ASC`;

        const [msgs] = await pool.query(query, params);
        const [user] = await pool.query('SELECT profile_name, last_seen FROM users WHERE id = ?', [contactId]);
        res.json({ messages: msgs, contact: user[0] });
    } catch (e) { res.json({ messages: [] }); }
});

app.get('/my-contacts', requireAuth, async (req, res) => {
    await pool.query('UPDATE users SET last_seen = NOW() WHERE id = ?', [req.session.userId]);
    const [contacts] = await pool.query(`
        SELECT u.id, u.profile_name, c.last_chat_time,
        (SELECT COUNT(*) FROM direct_messages WHERE sender_id = u.id AND receiver_id = ? AND status != 'read') as unread_count
        FROM users u JOIN contacts c ON u.id = c.contact_id WHERE c.user_id = ? ORDER BY c.last_chat_time DESC`, [req.session.userId, req.session.userId]);
    res.json(contacts);
});

// --- SOCKET ---
io.engine.use((req, res, next) => {
    session({ key: 'chatx_session', secret: 'chatx_secret_key_99', store: sessionStore })(req, res, next);
});

io.on('connection', (socket) => {
    const userId = socket.request.session.userId;
    if (!userId) return;
    socket.join(`user_${userId}`);

    socket.on('send-message', async (data, callback) => {
        await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message, status, reply_to_id) VALUES (?, ?, ?, "sent", ?)', 
            [userId, data.toId, data.text, data.replyTo || null]);
        await pool.query('UPDATE contacts SET last_chat_time = NOW() WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)', [userId, data.toId, data.toId, userId]);
        io.to(`user_${data.toId}`).emit('receive-message', { fromId: userId, text: data.text });
        if (callback) callback({ success: true });
    });
});

server.listen(process.env.PORT || 3000);
