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
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0


});

// --- UI (Single Page) ---
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Live Page Chat</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, sans-serif; margin: 0; background: #e5ddd5; display: flex; flex-direction: column; height: 100vh; }
        header { background: #075e54; color: white; padding: 15px; text-align: center; font-weight: bold; }
        #chat-box { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 8px; }
        .msg { background: white; padding: 8px 12px; border-radius: 8px; max-width: 80%; width: fit-content; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
        .input-area { background: #f0f0f0; padding: 10px; display: flex; gap: 8px; }
        input { flex: 1; padding: 12px; border-radius: 20px; border: 1px solid #ddd; outline: none; }
        button { background: #075e54; color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer; }
    </style>
</head>
<body>
    <header>Room: <span id="room-name"></span></header>
    <div id="chat-box"></div>
    <div class="input-area">
        <input type="text" id="msg-input" placeholder="Type a message..." autocomplete="off">
        <button onclick="send()">Send</button>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const room = window.location.pathname;
        document.getElementById('room-name').innerText = room;

        socket.emit('join', room);

        // Load old messages from DB
        socket.on('load-history', (msgs) => {
            msgs.forEach(m => appendMsg(m.content));
        });

        socket.on('message', (txt) => appendMsg(txt));

        function appendMsg(text) {
            const box = document.getElementById('chat-box');
            const div = document.createElement('div');
            div.className = 'msg';
            div.textContent = text;
            box.appendChild(div);
            box.scrollTop = box.scrollHeight;
        }

        function send() {
            const input = document.getElementById('msg-input');
            if(input.value.trim()) {
                socket.emit('chat', { room, text: input.value });
                input.value = '';
            }
        }

        document.getElementById('msg-input').addEventListener('keypress', e => {
            if(e.key === 'Enter') send();
        });
    </script>
</body>
</html>
`;

app.get('*', (req, res) => res.send(htmlContent));

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    socket.on('join', (room) => {
        socket.join(room);
        
        // Fetch last 50 messages for this specific URL
        pool.query('SELECT content FROM messages WHERE room = ? ORDER BY id ASC LIMIT 50', [room], (err, results) => {
            if (!err) socket.emit('load-history', results);
        });
    });

    socket.on('chat', (data) => {
        // Save message to Razorhost DB
        pool.query('INSERT INTO messages (room, content) VALUES (?, ?)', [data.room, data.text], (err) => {
            if (err) console.error("DB Error:", err);
        });
        // Send to everyone in the room
        io.to(data.room).emit('message', data.text);
    });
});

server.listen(process.env.PORT || 3000);
