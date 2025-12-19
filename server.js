const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// The HTML is served directly from this string for a single-file setup
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Live Page Chat</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, sans-serif; margin: 0; display: flex; flex-direction: column; height: 100vh; background: #f0f2f5; }
        header { background: #007bff; color: white; padding: 15px; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        #chat-box { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
        .msg { background: white; padding: 10px 15px; border-radius: 18px; max-width: 80%; width: fit-content; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
        .input-area { background: white; padding: 15px; display: flex; gap: 10px; border-top: 1px solid #ddd; }
        input { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 25px; outline: none; }
        button { background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold; }
        button:hover { background: #0056b3; }
    </style>
</head>
<body>
    <header>Chatting on: <span id="room-name"></span></header>
    <div id="chat-box"></div>
    <div class="input-area">
        <input type="text" id="message-input" placeholder="Say something..." autocomplete="off">
        <button onclick="sendMessage()">Send</button>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const room = window.location.pathname; 
        document.getElementById('room-name').innerText = room;

        // Join the room based on the current URL
        socket.emit('join-room', room);

        socket.on('message', (msg) => {
            const box = document.getElementById('chat-box');
            const el = document.createElement('div');
            el.className = 'msg';
            el.textContent = msg;
            box.appendChild(el);
            box.scrollTop = box.scrollHeight;
        });

        function sendMessage() {
            const input = document.getElementById('message-input');
            if (input.value) {
                socket.emit('chat-msg', { room, text: input.value });
                input.value = '';
            }
        }

        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    </script>
</body>
</html>
`;

app.get('*', (req, res) => {
    res.send(htmlContent);
});

io.on('connection', (socket) => {
    socket.on('join-room', (room) => {
        socket.join(room);
    });

    socket.on('chat-msg', (data) => {
        io.to(data.room).emit('message', data.text);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server is live!'));
