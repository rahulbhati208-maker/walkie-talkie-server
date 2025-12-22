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
    key: 'chatx_session', secret: 'chatx_secure_88', store: sessionStore,
    resave: false, saveUninitialized: false, cookie: { maxAge: 1000 * 60 * 60 * 24 * 365 }
}));
app.use(express.static('public'));
app.use(express.json());

// Auth Middleware
const requireAuth = (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
    next();
};

// --- ROUTES ---
app.get('/', (req, res) => res.redirect('/chat'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/chat', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Auth
app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
        // Note: Use bcrypt.compare in production
        if (users.length && users[0].is_approved) {
            req.session.userId = users[0].id;
            req.session.save(() => res.redirect('/chat'));
        } else res.send("Invalid or Pending.");
    } catch (e) { res.status(500).send("DB Error"); }
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ myId: req.session.userId });
});

// --- API: SMART SYNC ---
app.get('/my-contacts', requireAuth, async (req, res) => {
    const myId = req.session.userId;
    // We UNION the user's own ID so they appear in their own list for "Note Taking"
    await pool.query('UPDATE users SET last_seen = NOW() WHERE id = ?', [myId]);
    
    // Check if "Self" contact exists, if not add it
    await pool.query('INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)', [myId, myId]);

    const [contacts] = await pool.query(`
        SELECT u.id, u.profile_name, u.last_seen, c.last_chat_time
        FROM users u 
        JOIN contacts c ON u.id = c.contact_id 
        WHERE c.user_id = ? 
        ORDER BY c.last_chat_time DESC`, [myId]);
    res.json(contacts);
});

app.get('/messages/:contactId', requireAuth, async (req, res) => {
    const myId = req.session.userId;
    const contactId = req.params.contactId;

    // Mark read
    if (myId !== parseInt(contactId)) {
        await pool.query("UPDATE direct_messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?", [contactId, myId]);
    }

    // Fetch Messages
    const [msgs] = await pool.query(`
        SELECT m.id, m.sender_id, m.message, m.created_at, m.status, m.is_starred
        FROM direct_messages m 
        WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
        ORDER BY m.created_at ASC`, [myId, contactId, contactId, myId]);
    
    res.json(msgs);
});

// --- SOCKET ---
io.engine.use((req, res, next) => {
    session({ key: 'chatx_session', secret: 'chatx_secure_88', store: sessionStore })(req, res, next);
});

io.on('connection', (socket) => {
    const userId = socket.request.session.userId;
    if (!userId) return socket.disconnect();
    
    socket.join(`user_${userId}`);

    socket.on('typing', (d) => io.to(`user_${d.toId}`).emit('is-typing', { fromId: userId }));
    socket.on('stop-typing', (d) => io.to(`user_${d.toId}`).emit('not-typing', { fromId: userId }));

    socket.on('send-message', async (data, callback) => {
        try {
            const [res] = await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message, status) VALUES (?, ?, ?, "sent")', 
                [userId, data.toId, data.text]);
            
            // Update Sort Order
            await pool.query('UPDATE contacts SET last_chat_time = NOW() WHERE user_id = ? AND contact_id = ?', [userId, data.toId]);
            await pool.query('UPDATE contacts SET last_chat_time = NOW() WHERE user_id = ? AND contact_id = ?', [data.toId, userId]);

            const msgPayload = {
                id: res.insertId,
                sender_id: userId,
                message: data.text,
                created_at: new Date(),
                status: 'sent'
            };

            // Emit to Recipient
            io.to(`user_${data.toId}`).emit('receive-message', msgPayload);
            
            // Emit back to Sender (for multi-device sync)
            if (userId !== data.toId) {
                 // only if not self-chat, otherwise we get duplicates
                 io.to(`user_${userId}`).emit('msg-sent-confirm', msgPayload); 
            }

            callback({ success: true, msg: msgPayload });
        } catch (e) { callback({ success: false }); }
    });
});

server.listen(process.env.PORT || 3000);
