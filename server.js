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
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30, httpOnly: true }
});

app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'public')));

// Clean Routing
app.get('/', (req, res) => res.redirect(req.session.userId ? '/chat' : '/login'));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/chat', (req, res) => req.session.userId ? res.sendFile(path.join(__dirname, 'public', 'index.html')) : res.redirect('/login'));

app.post('/register', async (req, res) => {
    const { phone, password, name } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (phone, password, profile_name, is_approved) VALUES (?, ?, ?, 0)', [phone, hashed, name]);
        res.send("Success! Wait for admin approval. <a href='/login'>Login</a>");
    } catch (e) { res.status(500).send("Error"); }
});

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (users.length && await bcrypt.compare(password, users[0].password)) {
        if (users[0].is_approved) {
            req.session.userId = users[0].id;
            req.session.isAdmin = users[0].is_admin;
            res.redirect('/chat');
        } else res.send("Pending approval.");
    } else res.send("Invalid.");
});

app.post('/add-contact', async (req, res) => {
    const [target] = await pool.query('SELECT id FROM users WHERE phone = ?', [req.body.phone]);
    if (target.length) {
        await pool.query('INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)', [req.session.userId, target[0].id]);
        res.sendStatus(200);
    } else res.sendStatus(404);
});

app.get('/my-contacts', async (req, res) => {
    const [contacts] = await pool.query(`
        SELECT u.id, u.phone, u.profile_name,
        (SELECT COUNT(*) FROM direct_messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
        FROM users u JOIN contacts c ON u.id = c.contact_id WHERE c.user_id = ?`, [req.session.userId, req.session.userId]);
    res.json(contacts);
});

app.get('/messages/:contactId', async (req, res) => {
    const myId = req.session.userId;
    const contactId = req.params.contactId;
    await pool.query('UPDATE direct_messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?', [contactId, myId]);
    const [msgs] = await pool.query(`SELECT id, sender_id, message, created_at FROM direct_messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY created_at ASC`, [myId, contactId, contactId, myId]);
    res.json(msgs);
});

io.engine.use(sessionMiddleware);
io.on('connection', (socket) => {
    const userId = socket.request.session.userId;
    if (!userId) return;
    socket.join(`user_${userId}`);
    socket.on('send-message', async (data) => {
        await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message, is_read) VALUES (?, ?, ?, 0)', [userId, data.toId, data.text]);
        await pool.query('INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)', [data.toId, userId]);
        io.to(`user_${data.toId}`).emit('receive-message', { fromId: userId, text: data.text });
    });
});

server.listen(process.env.PORT || 3000);
