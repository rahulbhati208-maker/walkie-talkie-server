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

// --- 1. ROBUST DATABASE CONFIG ---
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

// --- 2. LONG-LIVED SESSIONS (1 YEAR) ---
const sessionMiddleware = session({
    key: 'chatx_session',
    secret: 'chatx_secret_key_99',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24 * 365, // 1 Year
        httpOnly: true 
    }
});

app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// --- 3. AUTHENTICATION MIDDLEWARE ---
// Forces login if session is missing
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        // If it's an API call, send 401 so frontend can handle it
        if (req.path.startsWith('/api') || req.xhr) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        // If it's a page load, redirect
        return res.redirect('/login');
    }
    next();
};

// --- ROUTES ---

// Public Routes
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
        if (users.length && await bcrypt.compare(password, users[0].password)) {
            if (users[0].is_approved) {
                req.session.userId = users[0].id;
                req.session.save(() => res.redirect('/chat')); // Save before redirect
            } else res.send("Account pending approval.");
        } else res.send("Invalid credentials.");
    } catch (e) { res.status(500).send("DB Error"); }
});

// Protected Routes (Apply Middleware)
app.get('/', requireAuth, (req, res) => res.redirect('/chat'));
app.get('/chat', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- API ROUTES ---

app.get('/my-contacts', requireAuth, async (req, res) => {
    try {
        // Update Last Seen
        await pool.query('UPDATE users SET last_seen = NOW() WHERE id = ?', [req.session.userId]);
        
        const [contacts] = await pool.query(`
            SELECT u.id, u.profile_name, u.last_seen, c.last_chat_time,
            (SELECT COUNT(*) FROM direct_messages WHERE sender_id = u.id AND receiver_id = ? AND status != 'read') as unread_count
            FROM users u 
            JOIN contacts c ON u.id = c.contact_id 
            WHERE c.user_id = ? 
            ORDER BY c.last_chat_time DESC`, [req.session.userId, req.session.userId]);
        res.json(contacts);
    } catch (e) { res.status(500).json([]); }
});

// --- 4. MESSAGES API WITH DATE FILTER ---
app.get('/messages/:contactId', requireAuth, async (req, res) => {
    const myId = req.session.userId;
    const contactId = req.params.contactId;
    const { from, to } = req.query; // Get dates from URL

    try {
        // Mark as read
        await pool.query("UPDATE direct_messages SET status = 'read' WHERE sender_id = ? AND receiver_id = ?", [contactId, myId]);

        let query = `
            SELECT m.id, m.sender_id, m.message, m.created_at, m.status, r.message as reply_text 
            FROM direct_messages m 
            LEFT JOIN direct_messages r ON m.reply_to_id = r.id
            WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
        `;
        
        const params = [myId, contactId, contactId, myId];

        // Apply Date Filter if provided
        if (from && to) {
            query += ` AND m.created_at BETWEEN ? AND ?`;
            params.push(`${from} 00:00:00`, `${to} 23:59:59`);
        }

        query += ` ORDER BY m.created_at ASC`;

        const [msgs] = await pool.query(query, params);
        const [user] = await pool.query('SELECT profile_name, last_seen FROM users WHERE id = ?', [contactId]);
        
        res.json({ messages: msgs, contact: user[0] });
    } catch (e) { res.status(500).json({ messages: [] }); }
});

// --- SOCKET.IO ---
io.engine.use(sessionMiddleware);

io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session || !session.userId) return socket.disconnect(); // Reject unauth sockets

    const userId = session.userId;
    socket.join(`user_${userId}`);

    socket.on('send-message', async (data, callback) => {
        try {
            await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message, status, reply_to_id) VALUES (?, ?, ?, "sent", ?)', 
                [userId, data.toId, data.text, data.replyTo || null]);
            
            await pool.query('UPDATE contacts SET last_chat_time = NOW() WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)', 
                [userId, data.toId, data.toId, userId]);
            
            io.to(`user_${data.toId}`).emit('receive-message', { fromId: userId, text: data.text });
            if(callback) callback({ success: true });
        } catch (e) { if(callback) callback({ success: false }); }
    });
});

server.listen(process.env.PORT || 3000, () => console.log("Server Running"));
