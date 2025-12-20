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

const dbOptions = { host: '37.27.71.198', user: 'ngyesawv_user', password: 'rahulB123@', database: 'ngyesawv_chatx' };
const pool = mysql.createPool(dbOptions);
const sessionStore = new MySQLStore(dbOptions);

const sessionMiddleware = session({ key: 'chatx_session', secret: 'secret', store: sessionStore, resave: false, saveUninitialized: false });
app.use(sessionMiddleware);
app.use(express.static('public'));
app.use(express.json());

// --- MODIFIED MESSAGE FETCH WITH DATE FILTER ---
app.get('/messages/:contactId', async (req, res) => {
    const myId = req.session.userId;
    const contactId = req.params.contactId;
    const { from, to } = req.query;

    let query = `SELECT sender_id, message, created_at, status FROM direct_messages 
                 WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`;
    let params = [myId, contactId, contactId, myId];

    if (from && to) {
        query += ` AND created_at BETWEEN ? AND ?`;
        params.push(`${from} 00:00:00`, `${to} 23:59:59`);
    }

    query += ` ORDER BY created_at ASC`;
    
    const [msgs] = await pool.query(query, params);
    res.json(msgs);
});

app.get('/my-contacts', async (req, res) => {
    const [contacts] = await pool.query(`SELECT u.id, u.phone, u.profile_name FROM users u JOIN contacts c ON u.id = c.contact_id WHERE c.user_id = ?`, [req.session.userId]);
    res.json(contacts);
});

io.engine.use(sessionMiddleware);
io.on('connection', (socket) => {
    const userId = socket.request.session.userId;
    if (!userId) return;
    socket.join(`user_${userId}`);

    // --- TYPING RELAY ---
    socket.on('typing', (data) => {
        io.to(`user_${data.toId}`).emit('is-typing', { fromId: userId });
    });
    socket.on('stop-typing', (data) => {
        io.to(`user_${data.toId}`).emit('not-typing', { fromId: userId });
    });

    socket.on('send-message', async (data, callback) => {
        await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message) VALUES (?, ?, ?)', [userId, data.toId, data.text]);
        io.to(`user_${data.toId}`).emit('receive-message', { fromId: userId, text: data.text });
        callback({ success: true });
    });
});

server.listen(process.env.PORT || 3000);
