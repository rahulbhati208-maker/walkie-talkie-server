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
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code)); // Ensure unique code
  return code;
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
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Arial', sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); overflow: hidden; }
        .header { background: #2c3e50; color: white; padding: 20px; text-align: center; }
        .connection-status { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 10px; font-size: 14px; }
        .status-dot { width: 12px; height: 12px; border-radius: 50%; background: #e74c3c; }
        .status-dot.connected { background: #27ae60; animation: pulse 1s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
        .join-section, .chat-section { padding: 30px; }
        .input-group { display: flex; flex-direction: column; gap: 15px; margin: 20px 0; }
        input { padding: 15px; border: 2px solid #bdc3c7; border-radius: 8px; font-size: 16px; }
        input:focus { outline: none; border-color: #3498db; }
        button { background: #3498db; color: white; border: none; padding: 15px; border-radius: 25px; cursor: pointer; font-size: 16px; transition: all 0.3s ease; }
        button:hover { background: #2980b9; }
        button:disabled { background: #95a5a6; cursor: not-allowed; }
        .talk-btn { background: #27ae60; font-size: 18px; font-weight: bold; padding: 20px; width: 150px; height: 150px; border-radius: 50%; margin: 20px auto; display: block; }
        .talk-btn.talking { background: #e74c3c; animation: pulse 1s infinite; }
        .talk-btn:disabled { background: #95a5a6; }
        .hidden { display: none; }
        .error-message { background: #e74c3c; color: white; padding: 15px; border-radius: 8px; margin: 15px 0; text-align: center; }
        .success-message { background: #27ae60; color: white; padding: 15px; border-radius: 8px; margin: 15px 0; text-align: center; }
        .status-indicators { display: flex; justify-content: center; gap: 30px; margin: 20px 0; }
        .status-item { display: flex; align-items: center; gap: 10px; }
        .status-dot { width: 20px; height: 20px; border-radius: 50%; background: #95a5a6; }
        .status-dot.active { background: #27ae60; animation: status-pulse 1s infinite; }
        .admin-status.active { background: #e74c3c; }
        @keyframes status-pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
        .user-info { text-align: center; margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Walkie Talkie User</h1>
            <div class="connection-status">
                <div class="status-dot" id="connectionStatus"></div>
                <span id="connectionText">Connecting...</span>
            </div>
        </div>
        <div class="join-section" id="joinSection">
            <h2>Join Room</h2>
            <div class="input-group">
                <input type="text" id="userName" placeholder="Enter your name" maxlength="20">
                <input type="text" id="roomCode" placeholder="Enter 4-digit room code" maxlength="4" pattern="[0-9]{4}">
                <button id="joinRoomBtn" disabled>Join Room</button>
            </div>
        </div>
        <div class="chat-section hidden" id="chatSection">
            <div class="user-info">
                <div>Connected as: <strong id="currentUserName"></strong></div>
                <div>Room: <strong id="currentRoomCode"></strong></div>
            </div>
            <button id="talkBtn" class="talk-btn" disabled>Press to Talk</button>
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
        <div class="error-message hidden" id="errorMessage"></div>
        <div class="success-message hidden" id="successMessage"></div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        class WalkieTalkieApp {
            constructor() {
                this.socket = null;
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
                this.connectToServer();
                this.checkPageType();
            }

            connectToServer() {
                console.log('Connecting to server...');
                this.socket = io();
                
                this.socket.on('connect', () => {
                    console.log('✅ Connected to server');
                    this.updateConnectionStatus(true);
                    this.enableButtons();
                });

                this.socket.on('disconnect', () => {
                    console.log('❌ Disconnected from server');
                    this.updateConnectionStatus(false);
                    this.disableButtons();
                });

                this.socket.on('connect_error', (error) => {
                    console.log('❌ Connection error:', error);
                    this.updateConnectionStatus(false);
                    this.disableButtons();
                });

                this.setupSocketListeners();
            }

            updateConnectionStatus(connected) {
                const statusDot = document.getElementById('connectionStatus');
                const statusText = document.getElementById('connectionText');
                
                if (connected) {
                    statusDot.className = 'status-dot connected';
                    statusText.textContent = 'Connected';
                    statusText.style.color = '#27ae60';
                } else {
                    statusDot.className = 'status-dot';
                    statusText.textContent = 'Disconnected';
                    statusText.style.color = '#e74c3c';
                }
            }

            enableButtons() {
                document.getElementById('joinRoomBtn').disabled = false;
                if (this.roomCode) {
                    document.getElementById('talkBtn').disabled = false;
                }
            }

            disableButtons() {
                document.getElementById('joinRoomBtn').disabled = true;
                document.getElementById('talkBtn').disabled = true;
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
                this.socket.on('room-created', (data) => {
                    console.log('✅ Room created:', data.roomCode);
                    this.roomCode = data.roomCode;
                    document.getElementById('roomCode').textContent = data.roomCode;
                    this.showSuccess('Room created with code: ' + data.roomCode);
                    document.getElementById('talkToAllBtn').disabled = false;
                });

                this.socket.on('room-joined', (data) => {
                    console.log('✅ Room joined:', data.roomCode);
                    this.roomCode = data.roomCode;
                    this.userName = data.userName;
                    document.getElementById('currentUserName').textContent = data.userName;
                    document.getElementById('currentRoomCode').textContent = data.roomCode;
                    document.getElementById('joinSection').classList.add('hidden');
                    document.getElementById('chatSection').classList.remove('hidden');
                    document.getElementById('talkBtn').disabled = false;
                    this.showSuccess('Successfully joined room: ' + data.roomCode);
                });

                this.socket.on('user-joined', (data) => {
                    console.log('👤 User joined:', data.userName);
                    this.addUserToUI(data.userId, data.userName);
                    this.showSuccess('User ' + data.userName + ' joined the room');
                });

                this.socket.on('users-update', (users) => {
                    console.log('📊 Users updated:', users.length + ' users');
                    this.updateUsersList(users);
                });

                this.socket.on('user-talking', (data) => {
                    console.log('🎤 User talking:', data.userId, 'isTalking:', data.isTalking);
                    this.updateTalkingIndicator(data.userId, data.targetUserId, data.isTalking);
                    if (data.recordingId) {
                        this.currentRecordingId = data.recordingId;
                    }
                });

                this.socket.on('recording-started', (data) => {
                    console.log('🔴 Recording started:', data.recordingId);
                    this.currentRecordingId = data.recordingId;
                    this.startAudioRecording();
                });

                this.socket.on('user-left', (data) => {
                    console.log('👤 User left:', data.userName);
                    this.removeUserFromUI(data.userId);
                    this.showMessage('User ' + data.userName + ' left the room');
                });

                this.socket.on('blocked', (data) => {
                    console.log('🚫 User blocked:', data.message);
                    this.showError(data.message);
                    this.leaveRoom();
                });

                this.socket.on('room-closed', () => {
                    console.log('🚪 Room closed by admin');
                    this.showError('Room has been closed by admin');
                    this.leaveRoom();
                });

                this.socket.on('error', (data) => {
                    console.log('❌ Error:', data.message);
                    this.showError(data.message);
                });
            }

            createRoom() {
                console.log('🔄 Creating room...');
                this.socket.emit('create-room');
            }

            joinRoom() {
                const userName = document.getElementById('userName').value.trim();
                const roomCode = document.getElementById('roomCode').value.trim();

                if (!userName) {
                    this.showError('Please enter your name');
                    return;
                }

                if (!roomCode || roomCode.length !== 4 || !/^\d{4}$/.test(roomCode)) {
                    this.showError('Please enter a valid 4-digit room code');
                    return;
                }

                console.log('🔄 Joining room:', roomCode, 'as:', userName);
                this.userName = userName;
                this.socket.emit('join-room', { roomCode, userName });
            }

            startTalking(targetUserId) {
                if (!this.roomCode || !this.socket.connected) {
                    this.showError('Not connected to room');
                    return;
                }
                
                console.log('🎤 Start talking to:', targetUserId);
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
                
                console.log('🔇 Stop talking');
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
                        console.log('💾 Sending recording:', this.currentRecordingId);
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
                    console.log('🎙️ Starting audio recording...');
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        } 
                    });
                    this.mediaRecorder = new MediaRecorder(stream, {
                        mimeType: 'audio/webm;codecs=opus'
                    });
                    this.audioChunks = [];

                    this.mediaRecorder.ondataavailable = (event) => {
                        if (event.data.size > 0) {
                            this.audioChunks.push(event.data);
                        }
                    };

                    this.mediaRecorder.start(100); // Collect data every 100ms
                    console.log('✅ Audio recording started');
                } catch (error) {
                    console.error('❌ Error starting audio recording:', error);
                    this.showError('Could not access microphone. Please check permissions.');
                }
            }

            stopAudioRecording() {
                return new Promise((resolve) => {
                    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                        this.mediaRecorder.onstop = () => {
                            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                            console.log('💾 Recording stopped, blob size:', audioBlob.size);
                            resolve(audioBlob);
                            
                            // Stop all tracks
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
                userCard.innerHTML = \`
                    <div class="user-avatar">\${userName.charAt(0).toUpperCase()}</div>
                    <div class="user-name">\${userName}</div>
                    <button class="individual-talk-btn" id="talk-btn-\${userId}">Talk</button>
                    <button class="block-btn" onclick="app.blockUser('\${userName}')">Block</button>
                \`;

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
                    console.log('🚫 Blocking user:', userName);
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
                    document.getElementById('talkToAllBtn').disabled = true;
                } else {
                    document.getElementById('joinSection').classList.remove('hidden');
                    document.getElementById('chatSection').classList.add('hidden');
                    document.getElementById('talkBtn').disabled = true;
                }
                this.roomCode = null;
            }

            showMessage(message) {
                console.log('💬', message);
            }

            showSuccess(message) {
                const successElement = document.getElementById('successMessage');
                if (successElement) {
                    successElement.textContent = message;
                    successElement.classList.remove('hidden');
                    setTimeout(() => {
                        successElement.classList.add('hidden');
                    }, 5000);
                }
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
    </script>
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
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Arial', sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); overflow: hidden; }
        .header { background: #2c3e50; color: white; padding: 20px; text-align: center; }
        .connection-status { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 10px; font-size: 14px; }
        .status-dot { width: 12px; height: 12px; border-radius: 50%; background: #e74c3c; }
        .status-dot.connected { background: #27ae60; animation: pulse 1s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
        .room-info { display: flex; justify-content: space-between; align-items: center; margin-top: 15px; flex-wrap: wrap; }
        #roomCode { font-size: 2em; font-weight: bold; color: #f39c12; background: rgba(255,255,255,0.1); padding: 10px 20px; border-radius: 10px; margin: 0 10px; }
        button { background: #3498db; color: white; border: none; padding: 12px 24px; border-radius: 25px; cursor: pointer; font-size: 16px; transition: all 0.3s ease; margin: 5px; }
        button:hover { background: #2980b9; transform: translateY(-2px); }
        button:active { transform: translateY(0); }
        button:disabled { background: #95a5a6; cursor: not-allowed; }
        .talk-btn { background: #27ae60; font-size: 18px; font-weight: bold; padding: 15px 30px; }
        .talk-btn.talking { background: #e74c3c; animation: pulse 1s infinite; }
        .talk-btn:disabled { background: #95a5a6; }
        .users-container, .controls { padding: 20px; border-bottom: 1px solid #ecf0f1; }
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
        .hidden { display: none !important; }
        .error-message { background: #e74c3c; color: white; padding: 15px; border-radius: 8px; margin: 15px; text-align: center; }
        .success-message { background: #27ae60; color: white; padding: 15px; border-radius: 8px; margin: 15px; text-align: center; }
        @media (max-width: 768px) { .container { margin: 10px; border-radius: 10px; } .room-info { flex-direction: column; gap: 15px; } .users-list { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Walkie Talkie Admin</h1>
            <div class="connection-status">
                <div class="status-dot" id="connectionStatus"></div>
                <span id="connectionText">Connecting...</span>
            </div>
            <div class="room-info">
                <div id="roomCodeDisplay">Room Code: <span id="roomCode">----</span></div>
                <button id="createRoomBtn" disabled>Create New Room</button>
            </div>
        </div>

        <div class="users-container">
            <h2>Connected Users</h2>
            <div id="usersList" class="users-list"></div>
        </div>

        <div class="controls">
            <h2>Admin Controls</h2>
            <div class="talk-controls">
                <button id="talkToAllBtn" class="talk-btn" disabled>Talk to All Users</button>
                <div class="individual-controls" id="individualControls"></div>
            </div>
        </div>

        <div class="error-message hidden" id="errorMessage"></div>
        <div class="success-message hidden" id="successMessage"></div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        // Same JavaScript as user page but with admin-specific initialization
        class WalkieTalkieApp {
            constructor() {
                this.socket = null;
                this.roomCode = null;
                this.userName = 'Admin';
                this.isAdmin = true;
                this.isTalking = false;
                this.mediaRecorder = null;
                this.audioChunks = [];
                this.currentRecordingId = null;
                this.recordings = new Map();
                this.init();
            }

            init() {
                this.connectToServer();
                this.initAdmin();
            }

            connectToServer() {
                console.log('Connecting to server...');
                this.socket = io();
                
                this.socket.on('connect', () => {
                    console.log('✅ Connected to server');
                    this.updateConnectionStatus(true);
                    document.getElementById('createRoomBtn').disabled = false;
                });

                this.socket.on('disconnect', () => {
                    console.log('❌ Disconnected from server');
                    this.updateConnectionStatus(false);
                    document.getElementById('createRoomBtn').disabled = true;
                    document.getElementById('talkToAllBtn').disabled = true;
                });

                this.socket.on('connect_error', (error) => {
                    console.log('❌ Connection error:', error);
                    this.updateConnectionStatus(false);
                    document.getElementById('createRoomBtn').disabled = true;
                });

                this.setupSocketListeners();
            }

            updateConnectionStatus(connected) {
                const statusDot = document.getElementById('connectionStatus');
                const statusText = document.getElementById('connectionText');
                
                if (connected) {
                    statusDot.className = 'status-dot connected';
                    statusText.textContent = 'Connected';
                    statusText.style.color = '#27ae60';
                } else {
                    statusDot.className = 'status-dot';
                    statusText.textContent = 'Disconnected';
                    statusText.style.color = '#e74c3c';
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

            setupSocketListeners() {
                this.socket.on('room-created', (data) => {
                    console.log('✅ Room created:', data.roomCode);
                    this.roomCode = data.roomCode;
                    document.getElementById('roomCode').textContent = data.roomCode;
                    this.showSuccess('Room created with code: ' + data.roomCode);
                    document.getElementById('talkToAllBtn').disabled = false;
                });

                this.socket.on('user-joined', (data) => {
                    console.log('👤 User joined:', data.userName);
                    this.addUserToUI(data.userId, data.userName);
                    this.showSuccess('User ' + data.userName + ' joined the room');
                });

                this.socket.on('users-update', (users) => {
                    console.log('📊 Users updated:', users.length + ' users');
                    this.updateUsersList(users);
                });

                this.socket.on('user-talking', (data) => {
                    console.log('🎤 User talking:', data.userId, 'isTalking:', data.isTalking);
                    this.updateTalkingIndicator(data.userId, data.targetUserId, data.isTalking);
                    if (data.recordingId) {
                        this.currentRecordingId = data.recordingId;
                    }
                });

                this.socket.on('recording-started', (data) => {
                    console.log('🔴 Recording started:', data.recordingId);
                    this.currentRecordingId = data.recordingId;
                    this.startAudioRecording();
                });

                this.socket.on('user-left', (data) => {
                    console.log('👤 User left:', data.userName);
                    this.removeUserFromUI(data.userId);
                    this.showMessage('User ' + data.userName + ' left the room');
                });

                this.socket.on('error', (data) => {
                    console.log('❌ Error:', data.message);
                    this.showError(data.message);
                });
            }

            createRoom() {
                console.log('🔄 Creating room...');
                this.socket.emit('create-room');
            }

            startTalking(targetUserId) {
                if (!this.roomCode || !this.socket.connected) {
                    this.showError('Not connected to room');
                    return;
                }
                
                console.log('🎤 Start talking to:', targetUserId);
                this.isTalking = true;
                
                const talkBtn = targetUserId === 'all' ? 
                    document.getElementById('talkToAllBtn') : 
                    document.getElementById('talk-btn-' + targetUserId);
                if (talkBtn) talkBtn.classList.add('talking');

                this.socket.emit('start-talking', {
                    targetUserId: targetUserId,
                    roomCode: this.roomCode
                });
            }

            stopTalking() {
                if (!this.isTalking) return;
                
                console.log('🔇 Stop talking');
                this.isTalking = false;
                
                document.querySelectorAll('.talk-btn').forEach(btn => {
                    btn.classList.remove('talking');
                });

                this.stopAudioRecording().then(audioBlob => {
                    if (this.currentRecordingId) {
                        console.log('💾 Sending recording:', this.currentRecordingId);
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
                    console.log('🎙️ Starting audio recording...');
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        } 
                    });
                    this.mediaRecorder = new MediaRecorder(stream, {
                        mimeType: 'audio/webm;codecs=opus'
                    });
                    this.audioChunks = [];

                    this.mediaRecorder.ondataavailable = (event) => {
                        if (event.data.size > 0) {
                            this.audioChunks.push(event.data);
                        }
                    };

                    this.mediaRecorder.start(100);
                    console.log('✅ Audio recording started');
                } catch (error) {
                    console.error('❌ Error starting audio recording:', error);
                    this.showError('Could not access microphone. Please check permissions.');
                }
            }

            stopAudioRecording() {
                return new Promise((resolve) => {
                    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                        this.mediaRecorder.onstop = () => {
                            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                            console.log('💾 Recording stopped, blob size:', audioBlob.size);
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
                const usersList = document.getElementById('usersList');
                const individualControls = document.getElementById('individualControls');

                const userCard = document.createElement('div');
                userCard.className = 'user-card';
                userCard.id = 'user-' + userId;
                userCard.innerHTML = \`
                    <div class="user-avatar">\${userName.charAt(0).toUpperCase()}</div>
                    <div class="user-name">\${userName}</div>
                    <button class="individual-talk-btn" id="talk-btn-\${userId}">Talk</button>
                    <button class="block-btn" onclick="app.blockUser('\${userName}')">Block</button>
                \`;

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
                const usersList = document.getElementById('usersList');
                usersList.innerHTML = '';
                users.forEach(user => {
                    this.addUserToUI(user.id, user.name);
                });
            }

            updateTalkingIndicator(userId, targetUserId, isTalking) {
                const userCard = document.getElementById('user-' + userId);
                if (userCard) {
                    userCard.classList.toggle('talking', isTalking && userId !== this.socket.id);
                    userCard.classList.toggle('receiving', isTalking && targetUserId === userId);
                }
            }

            blockUser(userName) {
                if (this.roomCode) {
                    console.log('🚫 Blocking user:', userName);
                    this.socket.emit('block-user', {
                        roomCode: this.roomCode,
                        userName: userName
                    });
                }
            }

            showMessage(message) {
                console.log('💬', message);
            }

            showSuccess(message) {
                const successElement = document.getElementById('successMessage');
                if (successElement) {
                    successElement.textContent = message;
                    successElement.classList.remove('hidden');
                    setTimeout(() => {
                        successElement.classList.add('hidden');
                    }, 5000);
                }
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
    </script>
</body>
</html>
  `);
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

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
    console.log('🏠 Room created:', roomCode, 'by admin:', socket.id);
    socket.emit('room-created', { roomCode });
  });

  // User joins room
  socket.on('join-room', (data) => {
    const { roomCode, userName } = data;
    console.log('🔄 Join room attempt:', roomCode, 'by user:', userName);

    const room = rooms.get(roomCode);

    if (!room) {
      console.log('❌ Room not found:', roomCode);
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.blockedUsers.has(userName)) {
      console.log('🚫 User blocked from room:', userName);
      socket.emit('error', { message: 'You are blocked from this room' });
      return;
    }

    room.users.set(socket.id, {
      id: socket.id,
      name: userName,
      isTalking: false
    });

    socket.join(roomCode);
    console.log('✅ User joined room:', userName, 'to room:', roomCode);
    socket.emit('room-joined', { roomCode, userName });
    
    // Notify admin about new user
    socket.to(room.admin).emit('user-joined', {
      userId: socket.id,
      userName: userName
    });

    // Send current users to admin
    const users = Array.from(room.users.values());
    socket.to(room.admin).emit('users-update', users);
  });

  // Start talking (push-to-talk)
  socket.on('start-talking', (data) => {
    const { targetUserId, roomCode } = data;
    console.log('🎤 Start talking in room:', roomCode, 'from:', socket.id, 'to:', targetUserId);

    const room = rooms.get(roomCode);
    
    if (!room) {
      console.log('❌ Room not found for talking:', roomCode);
      return;
    }

    const speaker = room.users.get(socket.id) || 
                   (socket.id === room.admin ? { id: socket.id, name: 'Admin', isTalking: true } : null);
    
    if (speaker) {
      speaker.isTalking = true;
      
      // Create recording session
      const recordingId = uuidv4();
      userRecordings.set(recordingId, {
        roomCode,
        from: speaker.name,
        to: targetUserId === 'all' ? 'All Users' : (room.users.get(targetUserId)?.name || 'Admin'),
        startTime: new Date(),
        audioData: []
      });

      console.log('🔴 Recording started:', recordingId, 'From:', speaker.name, 'To:', targetUserId);

      // Notify all in room about who is talking to whom
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
    console.log('🔇 Stop talking, recording:', recordingId);

    const roomCode = Array.from(rooms.entries()).find(([code, room]) => 
      room.users.has(socket.id) || room.admin === socket.id
    )?.[0];

    if (roomCode) {
      const room = rooms.get(roomCode);
      const speaker = room.users.get(socket.id) || 
                     (socket.id === room.admin ? { id: socket.id, name: 'Admin' } : null);
      
      if (speaker) {
        speaker.isTalking = false;

        // Update recording
        const recording = userRecordings.get(recordingId);
        if (recording) {
          recording.endTime = new Date();
          recording.audioBlob = audioBlob;
          console.log('💾 Recording saved:', recordingId, 'Duration:', (recording.endTime - recording.startTime) + 'ms');
        }

        // Notify all to stop talking indicators
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
    console.log('🚫 Block user request:', userName, 'in room:', roomCode);
    
    const room = rooms.get(roomCode);
    
    if (room && socket.id === room.admin) {
      room.blockedUsers.add(userName);
      
      // Find and disconnect blocked user
      const userEntry = Array.from(room.users.entries()).find(([id, user]) => user.name === userName);
      if (userEntry) {
        const [userId, user] = userEntry;
        console.log('🔴 Disconnecting blocked user:', userName);
        io.to(userId).emit('blocked', { message: 'You have been blocked by admin' });
        room.users.delete(userId);
        socket.to(room.admin).emit('users-update', Array.from(room.users.values()));
      }
    }
  });

  // Disconnection handling
  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    
    // Find room where this socket was admin or user
    for (const [roomCode, room] of rooms.entries()) {
      if (room.admin === socket.id) {
        // Admin disconnected - close room
        console.log('🏠 Admin disconnected, closing room:', roomCode);
        io.to(roomCode).emit('room-closed');
        rooms.delete(roomCode);
        break;
      } else if (room.users.has(socket.id)) {
        // User disconnected
        const user = room.users.get(socket.id);
        room.users.delete(socket.id);
        console.log('👤 User disconnected:', user.name, 'from room:', roomCode);
        
        // Notify admin
        socket.to(room.admin).emit('user-left', {
          userId: socket.id,
          userName: user.name
        });
        
        // Send updated users list to admin
        const users = Array.from(room.users.values());
        socket.to(room.admin).emit('users-update', users);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('🚀 Server running on port', PORT);
  console.log('📱 User Page: http://localhost:' + PORT + '/');
  console.log('👑 Admin Page: http://localhost:' + PORT + '/admin');
});
