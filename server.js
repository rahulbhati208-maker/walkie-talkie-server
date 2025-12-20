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

const sessionMiddleware = session({
    key: 'whatsapp_session',
    secret: 'super_secret_key_123',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
});

app.use(sessionMiddleware);
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- AUTH ROUTES ---

app.post('/register', async (req, res) => {
    const { phone, password, name } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    try {
        await pool.query('INSERT INTO users (phone, password, profile_name) VALUES (?, ?, ?)', [phone, hashed, name]);
        res.send("Registration Success. Wait for Admin approval. <a href='/login'>Login</a>");
    } catch (e) { res.status(500).send("User already exists."); }
});

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (users.length && await bcrypt.compare(password, users[0].password)) {
        if (users[0].is_approved) {
            req.session.userId = users[0].id;
            req.session.phone = users[0].phone;
            req.session.name = users[0].profile_name;
            res.redirect('/chat');
        } else { res.send("Account pending approval."); }
    } else { res.send("Invalid login."); }
});

// --- CONTACTS LOGIC ---

// Search and add a contact by phone number
app.post('/add-contact', async (req, res) => {
    if (!req.session.userId) return res.status(401).send("Unauthorized");
    const { phone } = req.body;
    try {
        const [target] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
        if (!target.length) return res.send("<script>alert('User not found'); window.location='/chat';</script>");
        
        await pool.query('INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)', [req.session.userId, target[0].id]);
        res.redirect('/chat');
    } catch (e) { res.status(500).send("Error adding contact"); }
});

// Fetch user's persistent contact list
app.get('/my-contacts', async (req, res) => {
    if (!req.session.userId) return res.json([]);
    const [contacts] = await pool.query(`
        SELECT u.id, u.phone, u.profile_name 
        FROM users u 
        JOIN contacts c ON u.id = c.contact_id 
        WHERE c.user_id = ?`, [req.session.userId]);
    res.json(contacts);
});

// Load old messages for a specific contact
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

app.get('/chat', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// --- SOCKET.IO ---
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

server.listen(process.env.PORT || 3000, () => console.log('Server Live'));
