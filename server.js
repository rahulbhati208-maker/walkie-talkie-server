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

// --- 1. DATABASE CONFIGURATION ---
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

// --- 2. SESSION SETUP (1 YEAR) ---
const sessionMiddleware = session({
    key: 'chatx_session',
    secret: 'chatx_secret_key_99',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 365 } // 1 Year
});

app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Update Last Seen on every request
app.use(async (req, res, next) => {
    if (req.session.userId) {
        try { await pool.query('UPDATE users SET last_seen = NOW() WHERE id = ?', [req.session.userId]); } catch (e) {}
    }
    next();
});

// --- 3. MIDDLEWARE: REQUIRE LOGIN ---
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        if (req.xhr || req.path.startsWith('/api')) return res.status(401).json({ error: "Unauthorized" });
        return res.redirect('/login');
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.isAdmin) {
        return res.status(403).send("<h1>Access Denied</h1><p>You are not an Admin.</p><a href='/chat'>Go Back</a>");
    }
    next();
};

// --- 4. PAGE ROUTES ---
app.get('/', (req, res) => res.redirect(req.session.userId ? '/chat' : '/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/chat', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', requireAuth, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// --- 5. AUTHENTICATION API ---

app.post('/register', async (req, res) => {
    const { phone, password, name } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        // FORCE IS_APPROVED = 0
        await pool.query('INSERT INTO users (phone, password, profile_name, is_approved) VALUES (?, ?, ?, 0)', [phone, hashed, name]);
        res.send(`<h2>Registration Successful</h2><p>Your account is pending Admin approval.</p><a href='/login'>Go to Login</a>`);
    } catch (e) {
        console.error(e);
        res.status(500).send("Error: User might already exist.");
    }
});

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
        
        if (users.length === 0) return res.send("User not found. <a href='/register'>Register</a>");
        
        const match = await bcrypt.compare(password, users[0].password);
        if (!match) return res.send("Wrong password. <a href='/login'>Try again</a>");

        if (users[0].is_approved === 0) return res.send("<h2>Account Pending</h2><p>Please wait for an admin to approve your account.</p>");

        // Success
        req.session.userId = users[0].id;
        req.session.isAdmin = users[0].is_admin;
        req.session.save(() => res.redirect('/chat'));

    } catch (e) { res.status(500).send("Database Error"); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ myId: req.session.userId });
});

// --- 6. ADMIN API (RESTORED) ---

app.get('/api/admin/pending', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, phone, profile_name FROM users WHERE is_approved = 0');
        res.json(users);
    } catch (e) { res.status(500).json([]); }
});

app.get('/admin/approve/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE users SET is_approved = 1 WHERE id = ?', [req.params.id]);
        res.redirect('/admin'); // Refresh admin page
    } catch (e) { res.status(500).send("Error approving user"); }
});

// --- 7. CHAT API ---

app.post('/add-contact', requireAuth, async (req, res) => {
    const { phone } = req.body;
    const [target] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (target.length) {
        await pool.query('INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)', [req.session.userId, target[0].id]);
        res.sendStatus(200);
    } else res.status(404).send("User not found");
});

app.get('/my-contacts', requireAuth, async (req, res) => {
    const myId = req.session.userId;
    
    // Ensure "Self" contact exists for Notes
    await pool.query('INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)', [myId, myId]);

    const [contacts] = await pool.query(`
        SELECT u.id, u.profile_name, u.last_seen, c.last_chat_time,
        (SELECT COUNT(*) FROM direct_messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
        FROM users u 
        JOIN contacts c ON u.id = c.contact_id 
        WHERE c.user_id = ? 
        ORDER BY c.last_chat_time DESC`, [myId, myId]);
    res.json(contacts);
});

app.get('/messages/:contactId', requireAuth, async (req, res) => {
    const myId = req.session.userId;
    const contactId = req.params.contactId;
    const { from, to } = req.query;

    if (parseInt(contactId) !== myId) {
        await pool.query("UPDATE direct_messages SET is_read = 1, status = 'read' WHERE sender_id = ? AND receiver_id = ?", [contactId, myId]);
    }

    let query = `
        SELECT m.id, m.sender_id, m.message, m.created_at, m.status, m.is_starred, r.message as reply_text 
        FROM direct_messages m 
        LEFT JOIN direct_messages r ON m.reply_to_id = r.id
        WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
    `;
    const params = [myId, contactId, contactId, myId];

    if (from && to) {
        query += ` AND m.created_at >= ? AND m.created_at <= ?`;
        params.push(`${from} 00:00:00`, `${to} 23:59:59`);
    }

    query += ` ORDER BY m.created_at ASC`;

    const [msgs] = await pool.query(query, params);
    res.json({ messages: msgs });
});

// --- 8. SOCKET.IO ---
io.engine.use(sessionMiddleware);

io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session || !session.userId) return socket.disconnect();
    
    const userId = session.userId;
    socket.join(`user_${userId}`);

    socket.on('typing', (d) => io.to(`user_${d.toId}`).emit('is-typing', { fromId: userId }));
    socket.on('stop-typing', (d) => io.to(`user_${d.toId}`).emit('not-typing', { fromId: userId }));

    socket.on('send-message', async (data, callback) => {
        try {
            const [res] = await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message, status, reply_to_id) VALUES (?, ?, ?, "sent", ?)', 
                [userId, data.toId, data.text, data.replyTo || null]);
            
            // Update timestamps for sorting
            await pool.query('UPDATE contacts SET last_chat_time = NOW() WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)', 
                [userId, data.toId, data.toId, userId]);

            // Construct full msg object to send back
            const msgPayload = {
                id: res.insertId,
                sender_id: userId,
                receiver_id: data.toId,
                message: data.text,
                created_at: new Date(),
                status: 'sent',
                reply_text: data.replyTo ? (await getReplyText(data.replyTo)) : null
            };

            io.to(`user_${data.toId}`).emit('receive-message', msgPayload);
            
            // Send back to sender for multi-device/tab sync
            if (userId !== data.toId) io.to(`user_${userId}`).emit('msg-sent-confirm', msgPayload);

            if(callback) callback({ success: true, msg: msgPayload });

        } catch (e) { if(callback) callback({ success: false }); }
    });
});

async function getReplyText(msgId) {
    try {
        const [rows] = await pool.query('SELECT message FROM direct_messages WHERE id = ?', [msgId]);
        return rows.length ? rows[0].message : null;
    } catch (e) { return null; }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
