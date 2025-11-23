const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static('public'));
app.use(express.json());

// Store rooms and users
const rooms = new Map();
const userRecordings = new Map();

// Generate 4-digit room code
function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Serve HTML directly
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>User - Walkie Talkie</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Walkie Talkie User</h1>
        </div>
        <div class="join-section" id="joinSection">
            <h2>Join Room</h2>
            <div class="input-group">
                <input type="text" id="userName" placeholder="Enter your name" maxlength="20">
                <input type="text" id="roomCode" placeholder="Enter 4-digit room code" maxlength="4" pattern="[0-9]{4}">
                <button id="joinRoomBtn">Join Room</button>
            </div>
        </div>
        <div class="chat-section hidden" id="chatSection">
            <div class="user-info">
                <div>Connected as: <span id="currentUserName"></span></div>
                <div>Room: <span id="currentRoomCode"></span></div>
            </div>
            <div class="talk-controls">
                <button id="talkBtn" class="talk-btn user-talk-btn">Press to Talk</button>
                <div class="status-indicators">
                    <div class="status-item">
                        <div class="status-dot" id="userStatus"></div>
                        <span>Your Status</span>
                    </div>
                    <div class="status-item">
                        <div class="status-dot admin-status" id="adminStatus"></div>
                        <span>Admin Status</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="error-message hidden" id="errorMessage"></div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/script.js"></script>
</body>
</html>
  `);
});

app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - Walkie Talkie</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Walkie Talkie Admin</h1>
            <div class="room-info">
                <div id="roomCodeDisplay">Room Code: <span id="roomCode">----</span></div>
                <button id="createRoomBtn">Create New Room</button>
            </div>
        </div>
        <div class="users-container">
            <h2>Connected Users</h2>
            <div id="usersList" class="users-list"></div>
        </div>
        <div class="controls">
            <h2>Admin Controls</h2>
            <div class="talk-controls">
                <button id="talkToAllBtn" class="talk-btn">Talk to All Users</button>
                <div class="individual-controls" id="individualControls"></div>
            </div>
        </div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/script.js"></script>
</body>
</html>
  `);
});

// Serve CSS
app.get('/style.css', (req, res) => {
  res.set('Content-Type', 'text/css');
  res.send(`
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Arial', sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
.container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); overflow: hidden; }
.header { background: #2c3e50; color: white; padding: 20px; text-align: center; }
.room-info { display: flex; justify-content: space-between; align-items: center; margin-top: 15px; flex-wrap: wrap; }
#roomCode { font-size: 2em; font-weight: bold; color: #f39c12; background: rgba(255,255,255,0.1); padding: 10px 20px; border-radius: 10px; margin: 0 10px; }
button { background: #3498db; color: white; border: none; padding: 12px 24px; border-radius: 25px; cursor: pointer; font-size: 16px; transition: all 0.3s ease; margin: 5px; }
button:hover { background: #2980b9; transform: translateY(-2px); }
button:active { transform: translateY(0); }
.talk-btn { background: #27ae60; font-size: 18px; font-weight: bold; padding: 15px 30px; }
.talk-btn.talking { background: #e74c3c; animation: pulse 1s infinite; }
.user-talk-btn { width: 200px; height: 200px; border-radius: 50%; font-size: 20px; margin: 20px auto; display: block; }
@keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }
.users-container, .controls, .join-section, .chat-section { padding: 20px; border-bottom: 1px solid #ecf0f1; }
.users-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 15px; margin-top: 15px; }
.user-card { background: #f8f9fa; border: 2px solid #bdc3c7; border-radius: 10px; padding: 15px; text-align: center; transition: all 0.3s ease; }
.user-card.talking { border-color: #27ae60; background: #d5f4e6; animation: glow-green 1s infinite; }
.user-card.receiving { border-color: #e74c3c; background: #fadbd8; animation: glow-red 1s infinite; }
@keyframes glow-green { 0% { box-shadow: 0 0 5px #27ae60; } 50% { box-shadow: 0 0 20px #27ae60; } 100% { box-shadow: 0 0 5px #27ae60; } }
@keyframes glow-red { 0% { box-shadow: 0 0 5px #e74c3c; } 50% { box-shadow: 0 0 20px #e74c3c; } 100% { box-shadow: 0 0 5px #e74c3c; } }
.user-avatar { width: 60px; height: 60px; border-radius: 50%; background: #3498db; color: white; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; margin: 0 auto 10px; }
.user-name { font-weight: bold; margin-bottom: 10px; }
.individual-controls { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 15px; }
.individual-talk-btn { background: #9b59b6; }
.block-btn { background: #e74c3c; padding: 8px 16px; font-size: 12px; }
.status-indicators { display: flex; justify-content: center; gap: 30px; margin: 20px 0; }
.status-item { display: flex; align-items: center; gap: 10px; }
.status-dot { width: 20px; height: 20px; border-radius: 50%; background: #95a5a6; }
.status-dot.active { background: #27ae60; animation: status-pulse 1s infinite; }
.admin-status.active { background: #e74c3c; }
@keyframes status-pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
.input-group { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin: 20px 0; }
input { padding: 12px; border: 2px solid #bdc3c7; border-radius: 8px; font-size: 16px; min-width: 200px; }
input:focus { outline: none; border-color: #3498db; }
.hidden { display: none !important; }
.error-message { background: #e74c3c; color: white; padding: 15px; border-radius: 8px; margin: 15px; text-align: center; }
@media (max-width: 768px) { .container { margin: 10px; border-radius: 10px; } .room-info { flex-direction: column; gap: 15px; } .users-list { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); } .input-group { flex-direction: column; align-items: center; } input { width: 100%; max-width: 300px; } }
  `);
});

// Serve JavaScript
app.get('/script.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(`
class WalkieTalkieApp {
    constructor() {
        this.socket = io();
        this.roomCode = null;
        this.userName = null;
        this.isAdmin = false;
        this.isTalking = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.currentRecordingId = null;
        this.recordings = new Map();
        this.init();
    }

    init() {
        this.checkPageType();
        this.setupSocketListeners();
    }

    checkPageType() {
        this.isAdmin = window.location.pathname.includes('admin');
        if (this.isAdmin) {
            this.initAdmin();
        } else {
            this.initUser();
        }
    }

    initAdmin() {
        document.getElementById('createRoomBtn').addEventListener('click', () => this.createRoom());
        document.getElementById('talkToAllBtn').addEventListener('mousedown', () => this.startTalking('all'));
        document.getElementById('talkToAllBtn').addEventListener('mouseup', () => this.stopTalking());
        document.getElementById('talkToAllBtn').addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startTalking('all');
        });
        document.getElementById('talkToAllBtn').addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopTalking();
        });
    }

    initUser() {
        document.getElementById('joinRoomBtn').addEventListener('click', () => this.joinRoom());
        const talkBtn = document.getElementById('talkBtn');
        talkBtn.addEventListener('mousedown', () => this.startTalking('admin'));
        talkBtn.addEventListener('mouseup', () => this.stopTalking());
        talkBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startTalking('admin');
        });
        talkBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopTalking();
        });
        
        document.getElementById('userName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        document.getElementById('roomCode').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
        });

        this.socket.on('room-created', (data) => {
            this.roomCode = data.roomCode;
            document.getElementById('roomCode').textContent = data.roomCode;
            this.showMessage('Room created with code: ' + data.roomCode);
        });

        this.socket.on('room-joined', (data) => {
            this.roomCode = data.roomCode;
            this.userName = data.userName;
            document.getElementById('currentUserName').textContent = data.userName;
            document.getElementById('currentRoomCode').textContent = data.roomCode;
            document.getElementById('joinSection').classList.add('hidden');
            document.getElementById('chatSection').classList.remove('hidden');
        });

        this.socket.on('user-joined', (data) => {
            this.addUserToUI(data.userId, data.userName);
        });

        this.socket.on('users-update', (users) => {
            this.updateUsersList(users);
        });

        this.socket.on('user-talking', (data) => {
            this.updateTalkingIndicator(data.userId, data.targetUserId, data.isTalking);
            if (data.recordingId) {
                this.currentRecordingId = data.recordingId;
            }
        });

        this.socket.on('recording-started', (data) => {
            this.currentRecordingId = data.recordingId;
            this.startAudioRecording();
        });

        this.socket.on('user-left', (data) => {
            this.removeUserFromUI(data.userId);
        });

        this.socket.on('blocked', (data) => {
            this.showError(data.message);
            this.leaveRoom();
        });

        this.socket.on('room-closed', () => {
            this.showError('Room closed by admin');
            this.leaveRoom();
        });

        this.socket.on('error', (data) => {
            this.showError(data.message);
        });
    }

    createRoom() {
        this.socket.emit('create-room');
    }

    joinRoom() {
        const userName = document.getElementById('userName').value.trim();
        const roomCode = document.getElementById('roomCode').value.trim();

        if (!userName) {
            this.showError('Please enter your name');
            return;
        }

        if (!roomCode || roomCode.length !== 4) {
            this.showError('Please enter a valid 4-digit room code');
            return;
        }

        this.userName = userName;
        this.socket.emit('join-room', { roomCode, userName });
    }

    startTalking(targetUserId) {
        if (!this.roomCode) return;
        this.isTalking = true;
        
        if (this.isAdmin) {
            const talkBtn = targetUserId === 'all' ? 
                document.getElementById('talkToAllBtn') : 
                document.getElementById('talk-btn-' + targetUserId);
            if (talkBtn) talkBtn.classList.add('talking');
        } else {
            document.getElementById('talkBtn').classList.add('talking');
            document.getElementById('userStatus').classList.add('active');
        }

        this.socket.emit('start-talking', {
            targetUserId: targetUserId,
            roomCode: this.roomCode
        });
    }

    stopTalking() {
        if (!this.isTalking) return;
        this.isTalking = false;
        
        if (this.isAdmin) {
            document.querySelectorAll('.talk-btn').forEach(btn => {
                btn.classList.remove('talking');
            });
        } else {
            document.getElementById('talkBtn').classList.remove('talking');
            document.getElementById('userStatus').classList.remove('active');
        }

        this.stopAudioRecording().then(audioBlob => {
            if (this.currentRecordingId) {
                this.socket.emit('stop-talking', {
                    recordingId: this.currentRecordingId,
                    audioBlob: audioBlob
                });
                this.currentRecordingId = null;
            }
        });
    }

    async startAudioRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.start();
        } catch (error) {
            console.error('Error starting audio recording:', error);
            this.showError('Could not access microphone');
        }
    }

    stopAudioRecording() {
        return new Promise((resolve) => {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                    resolve(audioBlob);
                    this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
                };
                this.mediaRecorder.stop();
            } else {
                resolve(null);
            }
        });
    }

    addUserToUI(userId, userName) {
        if (!this.isAdmin) return;

        const usersList = document.getElementById('usersList');
        const individualControls = document.getElementById('individualControls');

        const userCard = document.createElement('div');
        userCard.className = 'user-card';
        userCard.id = 'user-' + userId;
        userCard.innerHTML = '
            <div class="user-avatar">' + userName.charAt(0).toUpperCase() + '</div>
            <div class="user-name">' + userName + '</div>
            <button class="individual-talk-btn" id="talk-btn-' + userId + '">Talk</button>
            <button class="block-btn" onclick="app.blockUser(\\'' + userName + '\\')">Block</button>
        ';

        usersList.appendChild(userCard);

        const talkBtn = document.getElementById('talk-btn-' + userId);
        talkBtn.addEventListener('mousedown', () => this.startTalking(userId));
        talkBtn.addEventListener('mouseup', () => this.stopTalking());
        talkBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startTalking(userId);
        });
        talkBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopTalking();
        });
    }

    removeUserFromUI(userId) {
        const userElement = document.getElementById('user-' + userId);
        if (userElement) {
            userElement.remove();
        }
    }

    updateUsersList(users) {
        if (!this.isAdmin) return;
        const usersList = document.getElementById('usersList');
        usersList.innerHTML = '';
        users.forEach(user => {
            this.addUserToUI(user.id, user.name);
        });
    }

    updateTalkingIndicator(userId, targetUserId, isTalking) {
        if (this.isAdmin) {
            const userCard = document.getElementById('user-' + userId);
            if (userCard) {
                userCard.classList.toggle('talking', isTalking && userId !== this.socket.id);
                userCard.classList.toggle('receiving', isTalking && targetUserId === userId);
            }
        } else {
            const adminStatus = document.getElementById('adminStatus');
            if (adminStatus) {
                adminStatus.classList.toggle('active', isTalking && userId !== this.socket.id);
            }
        }
    }

    blockUser(userName) {
        if (this.isAdmin && this.roomCode) {
            this.socket.emit('block-user', {
                roomCode: this.roomCode,
                userName: userName
            });
        }
    }

    leaveRoom() {
        if (this.isAdmin) {
            document.getElementById('roomCode').textContent = '----';
            document.getElementById('usersList').innerHTML = '';
        } else {
            document.getElementById('joinSection').classList.remove('hidden');
            document.getElementById('chatSection').classList.add('hidden');
        }
        this.roomCode = null;
    }

    showMessage(message) {
        console.log('Message:', message);
    }

    showError(message) {
        const errorElement = document.getElementById('errorMessage');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.remove('hidden');
            setTimeout(() => {
                errorElement.classList.add('hidden');
            }, 5000);
        }
    }
}

const app = new WalkieTalkieApp();
  `);
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Admin creates room
  socket.on('create-room', (data) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      admin: socket.id,
      users: new Map(),
      blockedUsers: new Set()
    };
    rooms.set(roomCode, room);
    
    socket.join(roomCode);
    socket.emit('room-created', { roomCode });
    console.log('Room created:', roomCode);
  });

  // User joins room
  socket.on('join-room', (data) => {
    const { roomCode, userName } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.blockedUsers.has(userName)) {
      socket.emit('error', { message: 'You are blocked from this room' });
      return;
    }

    room.users.set(socket.id, {
      id: socket.id,
      name: userName,
      isTalking: false
    });

    socket.join(roomCode);
    socket.emit('room-joined', { roomCode, userName });
    
    socket.to(room.admin).emit('user-joined', {
      userId: socket.id,
      userName: userName
    });

    const users = Array.from(room.users.values());
    socket.to(room.admin).emit('users-update', users);
  });

  // Start talking
  socket.on('start-talking', (data) => {
    const { targetUserId, roomCode } = data;
    const room = rooms.get(roomCode);
    
    if (!room) return;

    const speaker = room.users.get(socket.id) || 
                   (socket.id === room.admin ? { id: socket.id, name: 'Admin', isTalking: true } : null);
    
    if (speaker) {
      speaker.isTalking = true;
      
      const recordingId = uuidv4();
      userRecordings.set(recordingId, {
        roomCode,
        from: speaker.name,
        to: targetUserId === 'all' ? 'All Users' : (room.users.get(targetUserId)?.name || 'Admin'),
        startTime: new Date(),
        audioData: []
      });

      io.to(roomCode).emit('user-talking', {
        userId: socket.id,
        targetUserId: targetUserId,
        isTalking: true,
        recordingId: recordingId
      });

      socket.emit('recording-started', { recordingId });
    }
  });

  // Stop talking
  socket.on('stop-talking', (data) => {
    const { recordingId, audioBlob } = data;
    const roomCode = Array.from(rooms.entries()).find(([code, room]) => 
      room.users.has(socket.id) || room.admin === socket.id
    )?.[0];

    if (roomCode) {
      const room = rooms.get(roomCode);
      const speaker = room.users.get(socket.id) || 
                     (socket.id === room.admin ? { id: socket.id, name: 'Admin' } : null);
      
      if (speaker) {
        speaker.isTalking = false;

        const recording = userRecordings.get(recordingId);
        if (recording) {
          recording.endTime = new Date();
          recording.audioBlob = audioBlob;
        }

        io.to(roomCode).emit('user-talking', {
          userId: socket.id,
          isTalking: false
        });
      }
    }
  });

  // Block user
  socket.on('block-user', (data) => {
    const { roomCode, userName } = data;
    const room = rooms.get(roomCode);
    
    if (room && socket.id === room.admin) {
      room.blockedUsers.add(userName);
      
      const userEntry = Array.from(room.users.entries()).find(([id, user]) => user.name === userName);
      if (userEntry) {
        const [userId, user] = userEntry;
        io.to(userId).emit('blocked', { message: 'You have been blocked by admin' });
        room.users.delete(userId);
        socket.to(room.admin).emit('users-update', Array.from(room.users.values()));
      }
    }
  });

  // Disconnection handling
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    for (const [roomCode, room] of rooms.entries()) {
      if (room.admin === socket.id) {
        io.to(roomCode).emit('room-closed');
        rooms.delete(roomCode);
        break;
      } else if (room.users.has(socket.id)) {
        const user = room.users.get(socket.id);
        room.users.delete(socket.id);
        
        socket.to(room.admin).emit('user-left', {
          userId: socket.id,
          userName: user.name
        });
        
        const users = Array.from(room.users.values());
        socket.to(room.admin).emit('users-update', users);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
