const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- DATABASE SETUP ---
// Replace placeholders with your Razorhost Shared IP and DB info
const pool = mysql.createPool({
    host: '37.27.71.198', 
    user: 'ngyesawv_user', 
    password: 'rahulB123@', 
    database: 'ngyesawv_mock',
  const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// DB Connection
const dbOptions = {
    host: '37.27.71.198', 
    user: 'ngyesawv_user', 
    password: 'rahulB123@', 
    database: 'ngyesawv_mock'
};
const pool = mysql.createPool(dbOptions);
const sessionStore = new MySQLStore(dbOptions);

app.use(express.urlencoded({ extended: true }));
app.use(session({
    key: 'user_sid',
    secret: 'whatsapp_secret',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 } // 30 Days
}));

// --- Registration Logic ---
app.post('/register', async (req, res) => {
    const { phone, password, name } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    try {
        await pool.query('INSERT INTO users (phone, password, profile_name) VALUES (?, ?, ?)', [phone, hashed, name]);
        res.send("Registration successful. Wait for Admin approval.");
    } catch (e) { res.status(500).send("User already exists"); }
});

// --- Login Logic ---
app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (users.length && await bcrypt.compare(password, users[0].password)) {
        if (users[0].is_approved) {
            req.session.userId = users[0].id;
            res.redirect('/chat');
        } else { res.send("Account pending admin approval."); }
    } else { res.send("Invalid credentials."); }
});

// --- Socket.io for Real-time WhatsApp Style ---
io.on('connection', (socket) => {
    socket.on('join-private', (userId) => socket.join(`user_${userId}`));

    socket.on('send-direct-msg', async (data) => {
        // data = { senderId, receiverPhone, text }
        const [target] = await pool.query('SELECT id FROM users WHERE phone = ?', [data.receiverPhone]);
        if (target.length) {
            await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message) VALUES (?, ?, ?)', 
            [data.senderId, target[0].id, data.text]);
            
            io.to(`user_${target[0].id}`).emit('new-msg', { from: data.senderId, text: data.text });
        }
    });
});

server.listen(process.env.PORT || 3000);
