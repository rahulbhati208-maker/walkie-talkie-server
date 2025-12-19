const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Live Audio & Text Chat</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, sans-serif; margin: 0; background: #f4f7f6; height: 100vh; display: flex; flex-direction: column; }
        header { background: #333; color: white; padding: 15px; text-align: center; }
        #chat-box { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
        .msg { background: white; padding: 10px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); width: fit-content; }
        .controls { background: white; padding: 20px; display: flex; gap: 10px; border-top: 1px solid #ddd; align-items: center; }
        input { flex: 1; padding: 12px; border-radius: 5px; border: 1px solid #ccc; }
        button { padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        .btn-send { background: #007bff; color: white; }
        .btn-audio { background: #28a745; color: white; }
        .btn-recording { background: #dc3545 !important; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
    </style>
</head>
<body>
    <header>Live Room: <span id="room-id"></span></header>
    <div id="chat-box"></div>
    <div class="controls">
        <input type="text" id="text-input" placeholder="Type a message...">
        <button class="btn-send" onclick="sendText()">Send</button>
        <button id="audio-btn" class="btn-audio" onclick="toggleAudio()">🎤 Start Audio</button>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const room = window.location.pathname;
        document.getElementById('room-id').innerText = room;
        
        let mediaRecorder;
        let isRecording = false;

        socket.emit('join-room', room);

        // --- Text Chat Logic ---
        function sendText() {
            const input = document.getElementById('text-input');
            if(input.value) {
                socket.emit('msg', { room, text: input.value });
                input.value = '';
            }
        }

        socket.on('new-msg', (txt) => {
            const div = document.createElement('div');
            div.className = 'msg';
            div.textContent = txt;
            document.getElementById('chat-box').appendChild(div);
        });

        // --- Live Audio Logic ---
        async function toggleAudio() {
            const btn = document.getElementById('audio-btn');
            if (!isRecording) {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                
                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        socket.emit('audio-stream', { room, blob: event.data });
                    }
                };

                // Send audio chunks every 500ms for "live" feel
                mediaRecorder.start(500); 
                isRecording = true;
                btn.innerText = "🛑 Stop Audio";
                btn.classList.add('btn-recording');
            } else {
                mediaRecorder.stop();
                isRecording = false;
                btn.innerText = "🎤 Start Audio";
                btn.classList.remove('btn-recording');
            }
        }

        // Receive Audio from others
        socket.on('audio-receive', (blobData) => {
            const blob = new Blob([blobData], { type: 'audio/webm' });
            const audioURL = window.URL.createObjectURL(blob);
            const audio = new Audio(audioURL);
            audio.play();
        });
    </script>
</body>
</html>
`;

app.get('*', (req, res) => res.send(htmlContent));

io.on('connection', (socket) => {
    socket.on('join-room', (room) => socket.join(room));

    socket.on('msg', (data) => {
        io.to(data.room).emit('new-msg', data.text);
    });

    socket.on('audio-stream', (data) => {
        // Broadcast audio to everyone in the room EXCEPT the sender
        socket.to(data.room).emit('audio-receive', data.blob);
    });
});

server.listen(process.env.PORT || 3000);
