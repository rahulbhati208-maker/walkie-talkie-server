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

app.use(session({ key: 'chatx_session', secret: 'secret', store: sessionStore, resave: false, saveUninitialized: false, cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 } }));
app.use(express.static('public'));
app.use(express.json());

// Load messages with Reply Support
app.get('/messages/:contactId', async (req, res) => {
    const myId = req.session.userId;
    const contactId = req.params.contactId;
    
    const [msgs] = await pool.query(`
        SELECT m.*, r.message as reply_text 
        FROM direct_messages m 
        LEFT JOIN direct_messages r ON m.reply_to_id = r.id
        WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?) 
        ORDER BY m.created_at ASC`, [myId, contactId, contactId, myId]);
        
    const [user] = await pool.query('SELECT profile_name, last_seen FROM users WHERE id = ?', [contactId]);
    res.json({ messages: msgs, contact: user[0] });
});

app.get('/my-contacts', async (req, res) => {
    const [contacts] = await pool.query(`SELECT u.id, u.profile_name FROM users u JOIN contacts c ON u.id = c.contact_id WHERE c.user_id = ?`, [req.session.userId]);
    res.json(contacts);
});

io.on('connection', (socket) => {
    const userId = 1; // Simplified for this snippet, use session in real app
    socket.join(`user_${userId}`);

    socket.on('send-message', async (data, callback) => {
        await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, message, reply_to_id) VALUES (?, ?, ?, ?)', 
            [userId, data.toId, data.text, data.replyTo || null]);
        io.to(`user_${data.toId}`).emit('receive-message', { fromId: userId, text: data.text });
        callback({ success: true });
    });
});

server.listen(process.env.PORT || 3000);
