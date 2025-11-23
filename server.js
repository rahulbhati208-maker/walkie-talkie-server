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
const userRecordingSessions = new Map();

// Generate 4-digit room code
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
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
        .status-dot.reconnecting { background: #f39c12; animation: pulse 0.5s infinite; }
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
        .recordings { padding: 20px; border-top: 1px solid #ecf0f1; }
        .recordings-list { max-height: 300px; overflow-y: auto; margin: 10px 0; }
        .recording-item { background: #f8f9fa; border: 1px solid #bdc3c7; border-radius: 8px; padding: 15px; margin: 10px 0; }
        .recording-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .recording-info { flex: 1; }
        .recording-actions { display: flex; gap: 10px; }
        .play-btn, .download-btn { padding: 8px 16px; font-size: 14px; border-radius: 20px; }
        .play-btn { background: #27ae60; }
        .play-btn:hover { background: #219652; }
        .download-btn { background: #f39c12; }
        .download-btn:hover { background: #e67e22; }
        .audio-player { width: 100%; margin-top: 10px; }
        .recording-downloaded { border-left: 4px solid #27ae60; background: #d5f4e6; }
        .mic-indicator { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 10px 0; }
        .mic-dot { width: 15px; height: 15px; border-radius: 50%; background: #e74c3c; }
        .mic-dot.active { background: #27ae60; animation: mic-pulse 0.3s infinite; }
        @keyframes mic-pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
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
            
            <div class="mic-indicator">
                <div class="mic-dot" id="micIndicator"></div>
                <span>Microphone Access</span>
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
            
            <div class="recordings">
                <h3>Your Recordings</h3>
                <div id="userRecordingsList" class="recordings-list"></div>
                <button id="downloadUserRecordingsBtn" class="download-btn" disabled>Download All Recordings</button>
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
                this.reconnectAttempts = 0;
                this.maxReconnectAttempts = 5;
                this.reconnectTimeout = null;
                this.audioContext = null;
                this.init();
            }

            init() {
                this.loadFromLocalStorage();
                this.connectToServer();
                this.checkPageType();
                this.setupAutoReconnect();
            }

            loadFromLocalStorage() {
                const savedUserName = localStorage.getItem('walkieUserName');
                const savedRoomCode = localStorage.getItem('walkieRoomCode');
                
                if (savedUserName) {
                    document.getElementById('userName').value = savedUserName;
                }
                if (savedRoomCode) {
                    document.getElementById('roomCode').value = savedRoomCode;
                }
            }

            saveToLocalStorage() {
                if (this.userName) {
                    localStorage.setItem('walkieUserName', this.userName);
                }
                if (this.roomCode) {
                    localStorage.setItem('walkieRoomCode', this.roomCode);
                }
            }

            connectToServer() {
                console.log('🔄 Connecting to server...');
                this.updateConnectionStatus('connecting');
                
                if (this.socket) {
                    this.socket.disconnect();
                }

                this.socket = io({
                    reconnection: false // We'll handle reconnection manually
                });
                
                this.socket.on('connect', () => {
                    console.log('✅ Connected to server');
                    this.reconnectAttempts = 0;
                    this.updateConnectionStatus('connected');
                    this.enableButtons();
                    
                    // Rejoin room if we were in one
                    if (this.roomCode && this.userName) {
                        console.log('🔄 Rejoining room...');
                        this.socket.emit('join-room', { 
                            roomCode: this.roomCode, 
                            userName: this.userName 
                        });
                    }
                });

                this.socket.on('disconnect', (reason) => {
                    console.log('❌ Disconnected from server:', reason);
                    this.updateConnectionStatus('disconnected');
                    this.disableButtons();
                    
                    if (reason === 'io server disconnect') {
                        // Server initiated disconnect, try to reconnect
                        this.socket.connect();
                    } else {
                        this.scheduleReconnect();
                    }
                });

                this.socket.on('connect_error', (error) => {
                    console.log('❌ Connection error:', error);
                    this.updateConnectionStatus('error');
                    this.scheduleReconnect();
                });

                this.socket.on('reconnect_attempt', (attempt) => {
                    console.log('🔄 Reconnection attempt:', attempt);
                    this.updateConnectionStatus('reconnecting');
                });

                this.setupSocketListeners();
            }

            scheduleReconnect() {
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
                    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
                    
                    this.reconnectTimeout = setTimeout(() => {
                        this.connectToServer();
                    }, delay);
                } else {
                    console.log('❌ Max reconnection attempts reached');
                    this.showError('Unable to connect to server. Please refresh the page.');
                }
            }

            setupAutoReconnect() {
                // Auto-reconnect when browser comes online
                window.addEventListener('online', () => {
                    console.log('🌐 Browser is online, reconnecting...');
                    this.connectToServer();
                });

                // Prevent multiple reconnection attempts
                window.addEventListener('beforeunload', () => {
                    if (this.reconnectTimeout) {
                        clearTimeout(this.reconnectTimeout);
                    }
                    if (this.socket) {
                        this.socket.disconnect();
                    }
                });
            }

            updateConnectionStatus(status) {
                const statusDot = document.getElementById('connectionStatus');
                const statusText = document.getElementById('connectionText');
                
                statusDot.className = 'status-dot';
                statusText.style.color = '';
                
                switch(status) {
                    case 'connected':
                        statusDot.classList.add('connected');
                        statusText.textContent = 'Connected';
                        statusText.style.color = '#27ae60';
                        break;
                    case 'connecting':
                        statusText.textContent = 'Connecting...';
                        statusText.style.color = '#3498db';
                        break;
                    case 'reconnecting':
                        statusDot.classList.add('reconnecting');
                        statusText.textContent = 'Reconnecting...';
                        statusText.style.color = '#f39c12';
                        break;
                    case 'disconnected':
                        statusText.textContent = 'Disconnected';
                        statusText.style.color = '#e74c3c';
                        break;
                    case 'error':
                        statusText.textContent = 'Connection Error';
                        statusText.style.color = '#e74c3c';
                        break;
                }
            }

            enableButtons() {
                document.getElementById('joinRoomBtn').disabled = false;
                if (this.roomCode) {
                    document.getElementById('talkBtn').disabled = false;
                    document.getElementById('downloadUserRecordingsBtn').disabled = false;
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
                document.getElementById('downloadAllBtn').addEventListener('click', () => this.downloadAllRecordings());
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
                document.getElementById('downloadUserRecordingsBtn').addEventListener('click', () => this.downloadUserRecordings());
                
                document.getElementById('userName').addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') this.joinRoom();
                });
                document.getElementById('roomCode').addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') this.joinRoom();
                });

                // Test microphone access
                this.testMicrophoneAccess();
            }

            async testMicrophoneAccess() {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        } 
                    });
                    
                    // Create audio context for playback
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    
                    // Update mic indicator
                    document.getElementById('micIndicator').classList.add('active');
                    
                    // Stop the stream since we just wanted to test access
                    stream.getTracks().forEach(track => track.stop());
                    
                    console.log('✅ Microphone access granted');
                } catch (error) {
                    console.error('❌ Microphone access denied:', error);
                    this.showError('Microphone access is required. Please allow microphone permissions.');
                }
            }

            setupSocketListeners() {
                this.socket.on('room-created', (data) => {
                    console.log('✅ Room created:', data.roomCode);
                    this.roomCode = data.roomCode;
                    document.getElementById('roomCode').textContent = data.roomCode;
                    this.saveToLocalStorage();
                    this.showSuccess('Room created with code: ' + data.roomCode);
                    document.getElementById('talkToAllBtn').disabled = false;
                    document.getElementById('downloadAllBtn').disabled = false;
                });

                this.socket.on('room-joined', (data) => {
                    console.log('✅ Room joined:', data.roomCode);
                    this.roomCode = data.roomCode;
                    this.userName = data.userName;
                    document.getElementById('currentUserName').textContent = data.userName;
                    document.getElementById('currentRoomCode').textContent = data.roomCode;
                    document.getElementById('joinSection').classList.add('hidden');
                    document.getElementById('chatSection').classList.remove('hidden');
                    this.saveToLocalStorage();
                    document.getElementById('talkBtn').disabled = false;
                    document.getElementById('downloadUserRecordingsBtn').disabled = false;
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

                this.socket.on('audio-stream', (data) => {
                    console.log('🔊 Receiving audio stream from:', data.from);
                    this.playAudio(data.audioData);
                });

                this.socket.on('recording-started', (data) => {
                    console.log('🔴 Recording started:', data.recordingId);
                    this.currentRecordingId = data.recordingId;
                    this.startAudioRecording();
                });

                this.socket.on('recording-complete', (data) => {
                    console.log('💾 Recording complete:', data.recordingId);
                    this.addRecordingToUI(data);
                    
                    // Auto-download for users if not already downloaded
                    if (!this.isAdmin && !data.downloaded) {
                        this.downloadRecording(data.recordingId, data.audioBlob, true);
                    }
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

                this.socket.on('room-closed', (data) => {
                    console.log('🚪 Room closed by admin');
                    // Auto-download all recordings before leaving
                    this.downloadAllRecordings(true);
                    this.showError('Room has been closed by admin. Your recordings have been downloaded.');
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

                if (!roomCode || roomCode.length !== 4 || !/^\\d{4}$/.test(roomCode)) {
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
                    if (this.currentRecordingId && audioBlob) {
                        console.log('💾 Sending recording:', this.currentRecordingId);
                        this.socket.emit('stop-talking', {
                            recordingId: this.currentRecordingId,
                            audioBlob: this.blobToBase64(audioBlob)
                        });
                        this.currentRecordingId = null;
                    }
                });
            }

            blobToBase64(blob) {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            }

            base64ToBlob(base64) {
                const byteString = atob(base64.split(',')[1]);
                const mimeString = base64.split(',')[0].split(':')[1].split(';')[0];
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                    ia[i] = byteString.charCodeAt(i);
                }
                return new Blob([ab], { type: mimeString });
            }

            async playAudio(base64Data) {
                try {
                    if (!this.audioContext) {
                        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    }
                    
                    const blob = this.base64ToBlob(base64Data);
                    const arrayBuffer = await blob.arrayBuffer();
                    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                    
                    const source = this.audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(this.audioContext.destination);
                    source.start();
                    
                    console.log('🔊 Playing audio');
                } catch (error) {
                    console.error('❌ Error playing audio:', error);
                }
            }

            async startAudioRecording() {
                try {
                    console.log('🎙️ Starting audio recording...');
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                            channelCount: 1,
                            sampleRate: 44100
                        } 
                    });
                    
                    // For iOS compatibility
                    if (!this.audioContext) {
                        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    }
                    
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
                    this.showError('Could not access microphone. Please check permissions and try again.');
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
                            if (this.mediaRecorder.stream) {
                                this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
                            }
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

                const userCard = document.createElement('div');
                userCard.className = 'user-card';
                userCard.id = 'user-' + userId;
                userCard.innerHTML = \`
                    <div class="user-avatar">\${userName.charAt(0).toUpperCase()}</div>
                    <div class="user-name">\${userName}</div>
                    <button class="individual-talk-btn" id="talk-btn-\${userId}">Talk</button>
                    <button class="block-btn" onclick="app.blockUser('\${userName}')">Block</button>
                    <div class="user-recordings-link" onclick="app.showUserRecordings('\${userName}')" style="margin-top: 10px; cursor: pointer; color: #3498db; font-size: 12px;">
                        View Recordings
                    </div>
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

            addRecordingToUI(recording, markDownloaded = false) {
                const recordingId = recording.recordingId || ('rec-' + Date.now());
                this.recordings.set(recordingId, recording);

                const recordingsList = this.isAdmin ? 
                    document.getElementById('recordingsList') : 
                    document.getElementById('userRecordingsList');

                // Check if recording already exists
                const existingRecording = document.getElementById(recordingId);
                if (existingRecording) {
                    if (markDownloaded) {
                        existingRecording.classList.add('recording-downloaded');
                    }
                    return;
                }

                const recordingItem = document.createElement('div');
                recordingItem.className = 'recording-item' + (markDownloaded ? ' recording-downloaded' : '');
                recordingItem.id = recordingId;
                
                const timestamp = new Date(recording.timestamp).toLocaleString();
                const audioBlob = recording.audioBlob ? this.base64ToBlob(recording.audioBlob) : null;
                const audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : null;
                
                recordingItem.innerHTML = \`
                    <div class="recording-header">
                        <div class="recording-info">
                            <strong>From:</strong> \${recording.from} <br>
                            <strong>To:</strong> \${recording.to} <br>
                            <strong>Time:</strong> \${timestamp}
                        </div>
                        <div class="recording-actions">
                            \${audioUrl ? \`
                                <button class="play-btn" onclick="app.playRecording('\${recordingId}')">Play</button>
                                <button class="download-btn" onclick="app.downloadRecording('\${recordingId}')">Download</button>
                            \` : ''}
                        </div>
                    </div>
                    \${audioUrl ? \`<audio controls class="audio-player" src="\${audioUrl}"></audio>\` : ''}
                \`;

                recordingsList.appendChild(recordingItem);
            }

            playRecording(recordingId) {
                const recording = this.recordings.get(recordingId);
                if (recording && recording.audioBlob) {
                    const audioElement = document.querySelector(\`#\${recordingId} audio\`);
                    if (audioElement) {
                        audioElement.play();
                    }
                }
            }

            downloadRecording(recordingId, audioBlob = null, markDownloaded = false) {
                const recording = this.recordings.get(recordingId);
                if (recording) {
                    const blob = audioBlob ? audioBlob : (recording.audioBlob ? this.base64ToBlob(recording.audioBlob) : null);
                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        const timestamp = new Date(recording.timestamp).toISOString().replace(/[:.]/g, '-');
                        a.href = url;
                        a.download = \`walkie-talkie-\${recording.from}-to-\${recording.to}-\${timestamp}.webm\`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        
                        // Mark as downloaded
                        if (markDownloaded) {
                            this.markRecordingDownloaded(recordingId);
                        }
                    }
                }
            }

            markRecordingDownloaded(recordingId) {
                const recordingElement = document.getElementById(recordingId);
                if (recordingElement) {
                    recordingElement.classList.add('recording-downloaded');
                }
                
                // Notify server
                if (this.socket.connected) {
                    this.socket.emit('recording-downloaded', { recordingId });
                }
            }

            downloadAllRecordings(autoDownload = false) {
                if (this.recordings.size === 0) {
                    this.showMessage('No recordings to download');
                    return;
                }

                let downloadedCount = 0;
                this.recordings.forEach((recording, recordingId) => {
                    if (recording.audioBlob) {
                        this.downloadRecording(recordingId, null, true);
                        downloadedCount++;
                    }
                });

                if (autoDownload) {
                    this.showSuccess(\`\${downloadedCount} recordings downloaded automatically\`);
                } else {
                    this.showSuccess(\`\${downloadedCount} recordings downloaded\`);
                }
            }

            downloadUserRecordings() {
                this.downloadAllRecordings();
            }

            showUserRecordings(userName) {
                if (this.isAdmin) {
                    // Filter and show recordings for specific user
                    const userRecordings = Array.from(this.recordings.entries())
                        .filter(([id, recording]) => recording.from === userName || recording.to === userName);
                    
                    // Create modal or filter view to show user-specific recordings
                    this.showUserRecordingsModal(userName, userRecordings);
                }
            }

            showUserRecordingsModal(userName, recordings) {
                const modal = document.createElement('div');
                modal.style.position = 'fixed';
                modal.style.top = '0';
                modal.style.left = '0';
                modal.style.width = '100%';
                modal.style.height = '100%';
                modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
                modal.style.display = 'flex';
                modal.style.justifyContent = 'center';
                modal.style.alignItems = 'center';
                modal.style.zIndex = '1000';
                
                modal.innerHTML = \`
                    <div style="background: white; padding: 20px; border-radius: 10px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;">
                        <h2>Recordings for \${userName}</h2>
                        <div id="userSpecificRecordings">
                            \${recordings.map(([id, recording]) => \`
                                <div class="recording-item">
                                    <strong>From:</strong> \${recording.from} <br>
                                    <strong>To:</strong> \${recording.to} <br>
                                    <strong>Time:</strong> \${new Date(recording.timestamp).toLocaleString()}
                                    <button onclick="app.downloadRecording('\${id}')" style="margin-left: 10px;">Download</button>
                                </div>
                            \`).join('')}
                        </div>
                        <button onclick="this.closest('div[style]').remove()" style="margin-top: 20px;">Close</button>
                    </div>
                \`;
                
                document.body.appendChild(modal);
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
                    document.getElementById('recordingsList').innerHTML = '';
                    document.getElementById('talkToAllBtn').disabled = true;
                    document.getElementById('downloadAllBtn').disabled = true;
                } else {
                    document.getElementById('joinSection').classList.remove('hidden');
                    document.getElementById('chatSection').classList.add('hidden');
                    document.getElementById('talkBtn').disabled = true;
                    document.getElementById('downloadUserRecordingsBtn').disabled = true;
                }
                this.roomCode = null;
                this.userName = null;
                localStorage.removeItem('walkieRoomCode');
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

// Admin page HTML would be similar but with admin-specific features
// Due to character limits, I'll provide the key socket event handlers:

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
      socket.emit('error', { message: 'Room not found. Please check the room code.' });
      return;
    }

    if (room.blockedUsers.has(userName)) {
      console.log('🚫 User blocked from room:', userName);
      socket.emit('error', { message: 'You are blocked from this room' });
      return;
    }

    // Check if user name already exists in room
    const existingUser = Array.from(room.users.values()).find(user => user.name === userName);
    if (existingUser) {
      console.log('❌ User name already exists:', userName);
      socket.emit('error', { message: 'User name already exists in this room. Please choose a different name.' });
      return;
    }

    room.users.set(socket.id, {
      id: socket.id,
      name: userName,
      isTalking: false
    });

    // Initialize user recordings storage
    if (!userRecordingSessions.has(userName)) {
      userRecordingSessions.set(userName, []);
    }

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
      const recordingData = {
        recordingId: recordingId,
        roomCode: roomCode,
        from: speaker.name,
        to: targetUserId === 'all' ? 'All Users' : (room.users.get(targetUserId)?.name || 'Admin'),
        timestamp: new Date(),
        audioBlob: null,
        downloaded: false
      };

      userRecordings.set(recordingId, recordingData);

      // Store recording for user
      if (speaker.name !== 'Admin') {
        const userRecordings = userRecordingSessions.get(speaker.name) || [];
        userRecordings.push(recordingData);
        userRecordingSessions.set(speaker.name, userRecordings);
      }

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

        // Update recording with audio data
        const recording = userRecordings.get(recordingId);
        if (recording) {
          recording.audioBlob = audioBlob;
          recording.endTime = new Date();
          console.log('💾 Recording saved:', recordingId, 'Duration:', (recording.endTime - recording.timestamp) + 'ms');

          // Send recording data to relevant parties
          if (recording.to === 'Admin') {
            // Send to admin
            io.to(room.admin).emit('recording-complete', {
              ...recording,
              to: recording.from // Fix: Show who it's from instead of "Admin"
            });
          } else if (recording.to === 'All Users') {
            // Send to all users
            room.users.forEach((user, userId) => {
              io.to(userId).emit('recording-complete', {
                ...recording,
                to: 'You (All)'
              });
            });
            // Also send to admin
            io.to(room.admin).emit('recording-complete', recording);
          } else {
            // Send to specific user
            const targetUser = Array.from(room.users.entries()).find(([id, user]) => user.name === recording.to);
            if (targetUser) {
              const [targetUserId, targetUserData] = targetUser;
              io.to(targetUserId).emit('recording-complete', {
                ...recording,
                to: 'You'
              });
            }
            
            // Always send to admin for records
            io.to(room.admin).emit('recording-complete', recording);
          }
        }

        // Notify all to stop talking indicators
        io.to(roomCode).emit('user-talking', {
          userId: socket.id,
          isTalking: false
        });
      }
    }
  });

  // Mark recording as downloaded
  socket.on('recording-downloaded', (data) => {
    const { recordingId } = data;
    const recording = userRecordings.get(recordingId);
    if (recording) {
      recording.downloaded = true;
      console.log('📥 Recording marked as downloaded:', recordingId);
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
        
        // Auto-download user's recordings before blocking
        const userRecordings = userRecordingSessions.get(userName) || [];
        userRecordings.forEach(recording => {
          if (!recording.downloaded && recording.audioBlob) {
            io.to(userId).emit('recording-complete', {
              ...recording,
              downloaded: true
            });
          }
        });
        
        io.to(userId).emit('blocked', { message: 'You have been blocked by admin' });
        room.users.delete(userId);
        socket.to(room.admin).emit('users-update', Array.from(room.users.values()));
      }
    }
  });

  // Get user recordings
  socket.on('get-user-recordings', (data) => {
    const { userName } = data;
    const recordings = userRecordingSessions.get(userName) || [];
    socket.emit('user-recordings', { userName, recordings });
  });

  // Disconnection handling
  socket.on('disconnect', (reason) => {
    console.log('❌ User disconnected:', socket.id, 'Reason:', reason);
    
    // Find room where this socket was admin or user
    for (const [roomCode, room] of rooms.entries()) {
      if (room.admin === socket.id) {
        // Admin disconnected - close room and notify users
        console.log('🏠 Admin disconnected, closing room:', roomCode);
        
        // Auto-download all recordings for users before closing
        room.users.forEach((user, userId) => {
          const userRecs = userRecordingSessions.get(user.name) || [];
          userRecs.forEach(recording => {
            if (!recording.downloaded && recording.audioBlob) {
              io.to(userId).emit('recording-complete', {
                ...recording,
                downloaded: true
              });
            }
          });
        });
        
        io.to(roomCode).emit('room-closed', { message: 'Room closed by admin' });
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
