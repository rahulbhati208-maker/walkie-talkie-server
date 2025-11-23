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
                console.log('Connecting to server...');
                this.updateConnectionStatus('connecting');
                
                if (this.socket) {
                    this.socket.disconnect();
                }

                this.socket = io({
                    reconnection: false
                });
                
                this.socket.on('connect', () => {
                    console.log('Connected to server');
                    this.reconnectAttempts = 0;
                    this.updateConnectionStatus('connected');
                    this.enableButtons();
                    
                    if (this.roomCode && this.userName) {
                        console.log('Rejoining room...');
                        this.socket.emit('join-room', { 
                            roomCode: this.roomCode, 
                            userName: this.userName 
                        });
                    }
                });

                this.socket.on('disconnect', (reason) => {
                    console.log('Disconnected from server:', reason);
                    this.updateConnectionStatus('disconnected');
                    this.disableButtons();
                    
                    if (reason === 'io server disconnect') {
                        this.socket.connect();
                    } else {
                        this.scheduleReconnect();
                    }
                });

                this.socket.on('connect_error', (error) => {
                    console.log('Connection error:', error);
                    this.updateConnectionStatus('error');
                    this.scheduleReconnect();
                });

                this.socket.on('reconnect_attempt', (attempt) => {
                    console.log('Reconnection attempt:', attempt);
                    this.updateConnectionStatus('reconnecting');
                });

                this.setupSocketListeners();
            }

            scheduleReconnect() {
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
                    console.log('Reconnecting in ' + delay + 'ms (attempt ' + this.reconnectAttempts + ')');
                    
                    this.reconnectTimeout = setTimeout(() => {
                        this.connectToServer();
                    }, delay);
                } else {
                    console.log('Max reconnection attempts reached');
                    this.showError('Unable to connect to server. Please refresh the page.');
                }
            }

            setupAutoReconnect() {
                window.addEventListener('online', () => {
                    console.log('Browser is online, reconnecting...');
                    this.connectToServer();
                });

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
                    
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    
                    document.getElementById('micIndicator').classList.add('active');
                    
                    stream.getTracks().forEach(track => track.stop());
                    
                    console.log('Microphone access granted');
                } catch (error) {
                    console.error('Microphone access denied:', error);
                    this.showError('Microphone access is required. Please allow microphone permissions.');
                }
            }

            setupSocketListeners() {
                this.socket.on('room-created', (data) => {
                    console.log('Room created:', data.roomCode);
                    this.roomCode = data.roomCode;
                    document.getElementById('roomCode').textContent = data.roomCode;
                    this.saveToLocalStorage();
                    this.showSuccess('Room created with code: ' + data.roomCode);
                    document.getElementById('talkToAllBtn').disabled = false;
                    document.getElementById('downloadAllBtn').disabled = false;
                });

                this.socket.on('room-joined', (data) => {
                    console.log('Room joined:', data.roomCode);
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
                    console.log('User joined:', data.userName);
                    this.addUserToUI(data.userId, data.userName);
                    this.showSuccess('User ' + data.userName + ' joined the room');
                });

                this.socket.on('users-update', (users) => {
                    console.log('Users updated:', users.length + ' users');
                    this.updateUsersList(users);
                });

                this.socket.on('user-talking', (data) => {
                    console.log('User talking:', data.userId, 'isTalking:', data.isTalking);
                    this.updateTalkingIndicator(data.userId, data.targetUserId, data.isTalking);
                    if (data.recordingId) {
                        this.currentRecordingId = data.recordingId;
                    }
                });

                this.socket.on('audio-stream', (data) => {
                    console.log('Receiving audio stream from:', data.from);
                    this.playAudio(data.audioData);
                });

                this.socket.on('recording-started', (data) => {
                    console.log('Recording started:', data.recordingId);
                    this.currentRecordingId = data.recordingId;
                    this.startAudioRecording();
                });

                this.socket.on('recording-complete', (data) => {
                    console.log('Recording complete:', data.recordingId);
                    this.addRecordingToUI(data);
                    
                    if (!this.isAdmin && !data.downloaded) {
                        this.downloadRecording(data.recordingId, data.audioBlob, true);
                    }
                });

                this.socket.on('user-left', (data) => {
                    console.log('User left:', data.userName);
                    this.removeUserFromUI(data.userId);
                    this.showMessage('User ' + data.userName + ' left the room');
                });

                this.socket.on('blocked', (data) => {
                    console.log('User blocked:', data.message);
                    this.showError(data.message);
                    this.leaveRoom();
                });

                this.socket.on('room-closed', (data) => {
                    console.log('Room closed by admin');
                    this.downloadAllRecordings(true);
                    this.showError('Room has been closed by admin. Your recordings have been downloaded.');
                    this.leaveRoom();
                });

                this.socket.on('error', (data) => {
                    console.log('Error:', data.message);
                    this.showError(data.message);
                });
            }

            createRoom() {
                console.log('Creating room...');
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

                console.log('Joining room:', roomCode, 'as:', userName);
                this.userName = userName;
                this.socket.emit('join-room', { roomCode, userName });
            }

            startTalking(targetUserId) {
                if (!this.roomCode || !this.socket.connected) {
                    this.showError('Not connected to room');
                    return;
                }
                
                console.log('Start talking to:', targetUserId);
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
                
                console.log('Stop talking');
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
                        console.log('Sending recording:', this.currentRecordingId);
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
                    
                    console.log('Playing audio');
                } catch (error) {
                    console.error('Error playing audio:', error);
                }
            }

            async startAudioRecording() {
                try {
                    console.log('Starting audio recording...');
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                            channelCount: 1,
                            sampleRate: 44100
                        } 
                    });
                    
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

                    this.mediaRecorder.start(100);
                    console.log('Audio recording started');
                } catch (error) {
                    console.error('Error starting audio recording:', error);
                    this.showError('Could not access microphone. Please check permissions and try again.');
                }
            }

            stopAudioRecording() {
                return new Promise((resolve) => {
                    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                        this.mediaRecorder.onstop = () => {
                            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                            console.log('Recording stopped, blob size:', audioBlob.size);
                            resolve(audioBlob);
                            
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
                userCard.innerHTML = '<div class="user-avatar">' + userName.charAt(0).toUpperCase() + '</div>' +
                    '<div class="user-name">' + userName + '</div>' +
                    '<button class="individual-talk-btn" id="talk-btn-' + userId + '">Talk</button>' +
                    '<button class="block-btn" onclick="app.blockUser(\\'' + userName + '\\')">Block</button>' +
                    '<div class="user-recordings-link" onclick="app.showUserRecordings(\\'' + userName + '\\')" style="margin-top: 10px; cursor: pointer; color: #3498db; font-size: 12px;">View Recordings</div>';

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

                const existingRecording = document.getElementById(recordingId);
                if (existingRecording) {
                    if (markDownloaded) {
                        existingRecording.classList.add('recording-downloaded');
                    }
                    return;
                }

                const timestamp = new Date(recording.timestamp).toLocaleString();
                const audioBlob = recording.audioBlob ? this.base64ToBlob(recording.audioBlob) : null;
                const audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : null;
                
                const recordingItem = document.createElement('div');
                recordingItem.className = 'recording-item' + (markDownloaded ? ' recording-downloaded' : '');
                recordingItem.id = recordingId;
                
                recordingItem.innerHTML = '<div class="recording-header">' +
                    '<div class="recording-info">' +
                    '<strong>From:</strong> ' + recording.from + '<br>' +
                    '<strong>To:</strong> ' + recording.to + '<br>' +
                    '<strong>Time:</strong> ' + timestamp +
                    '</div>' +
                    '<div class="recording-actions">' +
                    (audioUrl ? '<button class="play-btn" onclick="app.playRecording(\\'' + recordingId + '\\')">Play</button>' +
                    '<button class="download-btn" onclick="app.downloadRecording(\\'' + recordingId + '\\')">Download</button>' : '') +
                    '</div>' +
                    '</div>' +
                    (audioUrl ? '<audio controls class="audio-player" src="' + audioUrl + '"></audio>' : '');

                recordingsList.appendChild(recordingItem);
            }

            playRecording(recordingId) {
                const recording = this.recordings.get(recordingId);
                if (recording && recording.audioBlob) {
                    const audioElement = document.querySelector('#' + recordingId + ' audio');
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
                        a.download = 'walkie-talkie-' + recording.from + '-to-' + recording.to + '-' + timestamp + '.webm';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        
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
                    this.showSuccess(downloadedCount + ' recordings downloaded automatically');
                } else {
                    this.showSuccess(downloadedCount + ' recordings downloaded');
                }
            }

            downloadUserRecordings() {
                this.downloadAllRecordings();
            }

            showUserRecordings(userName) {
                if (this.isAdmin) {
                    const userRecordings = Array.from(this.recordings.entries())
                        .filter(([id, recording]) => recording.from === userName || recording.to === userName);
                    
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
                
                let recordingsHTML = '';
                recordings.forEach(([id, recording]) => {
                    recordingsHTML += '<div class="recording-item">' +
                        '<strong>From:</strong> ' + recording.from + '<br>' +
                        '<strong>To:</strong> ' + recording.to + '<br>' +
                        '<strong>Time:</strong> ' + new Date(recording.timestamp).toLocaleString() +
                        '<button onclick="app.downloadRecording(\\'' + id + '\\')" style="margin-left: 10px;">Download</button>' +
                        '</div>';
                });
                
                modal.innerHTML = '<div style="background: white; padding: 20px; border-radius: 10px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;">' +
                    '<h2>Recordings for ' + userName + '</h2>' +
                    '<div id="userSpecificRecordings">' + recordingsHTML + '</div>' +
                    '<button onclick="this.closest(\\'div[style]\\').remove()" style="margin-top: 20px;">Close</button>' +
                    '</div>';
                
                document.body.appendChild(modal);
            }

            blockUser(userName) {
                if (this.isAdmin && this.roomCode) {
                    console.log('Blocking user:', userName);
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
                console.log(message);
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

// Admin page route
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
        .status-dot.reconnecting { background: #f39c12; animation: pulse 0.5s infinite; }
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
        .users-container, .controls, .recordings { padding: 20px; border-bottom: 1px solid #ecf0f1; }
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

        <div class="recordings">
            <h2>Recordings</h2>
            <div id="recordingsList" class="recordings-list"></div>
            <button id="downloadAllBtn" class="download-btn" disabled>Download All Recordings</button>
        </div>

        <div class="error-message hidden" id="errorMessage"></div>
        <div class="success-message hidden" id="successMessage"></div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        // Admin-specific JavaScript
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
                this.reconnectAttempts = 0;
                this.maxReconnectAttempts = 5;
                this.reconnectTimeout = null;
                this.audioContext = null;
                this.init();
            }

            init() {
                this.connectToServer();
                this.initAdmin();
                this.setupAutoReconnect();
            }

            connectToServer() {
                console.log('Connecting to server...');
                this.updateConnectionStatus('connecting');
                
                if (this.socket) {
                    this.socket.disconnect();
                }

                this.socket = io({
                    reconnection: false
                });
                
                this.socket.on('connect', () => {
                    console.log('Connected to server');
                    this.reconnectAttempts = 0;
                    this.updateConnectionStatus('connected');
                    document.getElementById('createRoomBtn').disabled = false;
                });

                this.socket.on('disconnect', (reason) => {
                    console.log('Disconnected from server:', reason);
                    this.updateConnectionStatus('disconnected');
                    document.getElementById('createRoomBtn').disabled = true;
                    document.getElementById('talkToAllBtn').disabled = true;
                    document.getElementById('downloadAllBtn').disabled = true;
                    
                    if (reason === 'io server disconnect') {
                        this.socket.connect();
                    } else {
                        this.scheduleReconnect();
                    }
                });

                this.socket.on('connect_error', (error) => {
                    console.log('Connection error:', error);
                    this.updateConnectionStatus('error');
                    this.scheduleReconnect();
                });

                this.socket.on('reconnect_attempt', (attempt) => {
                    console.log('Reconnection attempt:', attempt);
                    this.updateConnectionStatus('reconnecting');
                });

                this.setupSocketListeners();
            }

            scheduleReconnect() {
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
                    console.log('Reconnecting in ' + delay + 'ms (attempt ' + this.reconnectAttempts + ')');
                    
                    this.reconnectTimeout = setTimeout(() => {
                        this.connectToServer();
                    }, delay);
                } else {
                    console.log('Max reconnection attempts reached');
                    this.showError('Unable to connect to server. Please refresh the page.');
                }
            }

            setupAutoReconnect() {
                window.addEventListener('online', () => {
                    console.log('Browser is online, reconnecting...');
                    this.connectToServer();
                });

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

            setupSocketListeners() {
                this.socket.on('room-created', (data) => {
                    console.log('Room created:', data.roomCode);
                    this.roomCode = data.roomCode;
                    document.getElementById('roomCode').textContent = data.roomCode;
                    this.showSuccess('Room created with code: ' + data.roomCode);
                    document.getElementById('talkToAllBtn').disabled = false;
                    document.getElementById('downloadAllBtn').disabled = false;
                });

                this.socket.on('user-joined', (data) => {
                    console.log('User joined:', data.userName);
                    this.addUserToUI(data.userId, data.userName);
                    this.showSuccess('User ' + data.userName + ' joined the room');
                });

                this.socket.on('users-update', (users) => {
                    console.log('Users updated:', users.length + ' users');
                    this.updateUsersList(users);
                });

                this.socket.on('user-talking', (data) => {
                    console.log('User talking:', data.userId, 'isTalking:', data.isTalking);
                    this.updateTalkingIndicator(data.userId, data.targetUserId, data.isTalking);
                    if (data.recordingId) {
                        this.currentRecordingId = data.recordingId;
                    }
                });

                this.socket.on('recording-started', (data) => {
                    console.log('Recording started:', data.recordingId);
                    this.currentRecordingId = data.recordingId;
                    this.startAudioRecording();
                });

                this.socket.on('recording-complete', (data) => {
                    console.log('Recording complete:', data.recordingId);
                    this.addRecordingToUI(data);
                });

                this.socket.on('user-left', (data) => {
                    console.log('User left:', data.userName);
                    this.removeUserFromUI(data.userId);
                    this.showMessage('User ' + data.userName + ' left the room');
                });

                this.socket.on('error', (data) => {
                    console.log('Error:', data.message);
                    this.showError(data.message);
                });
            }

            createRoom() {
                console.log('Creating room...');
                this.socket.emit('create-room');
            }

            startTalking(targetUserId) {
                if (!this.roomCode || !this.socket.connected) {
                    this.showError('Not connected to room');
                    return;
                }
                
                console.log('Start talking to:', targetUserId);
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
                
                console.log('Stop talking');
                this.isTalking = false;
                
                document.querySelectorAll('.talk-btn').forEach(btn => {
                    btn.classList.remove('talking');
                });

                this.stopAudioRecording().then(audioBlob => {
                    if (this.currentRecordingId && audioBlob) {
                        console.log('Sending recording:', this.currentRecordingId);
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

            async startAudioRecording() {
                try {
                    console.log('Starting audio recording...');
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                            channelCount: 1,
                            sampleRate: 44100
                        } 
                    });
                    
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

                    this.mediaRecorder.start(100);
                    console.log('Audio recording started');
                } catch (error) {
                    console.error('Error starting audio recording:', error);
                    this.showError('Could not access microphone. Please check permissions and try again.');
                }
            }

            stopAudioRecording() {
                return new Promise((resolve) => {
                    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                        this.mediaRecorder.onstop = () => {
                            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                            console.log('Recording stopped, blob size:', audioBlob.size);
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

                const userCard = document.createElement('div');
                userCard.className = 'user-card';
                userCard.id = 'user-' + userId;
                userCard.innerHTML = '<div class="user-avatar">' + userName.charAt(0).toUpperCase() + '</div>' +
                    '<div class="user-name">' + userName + '</div>' +
                    '<button class="individual-talk-btn" id="talk-btn-' + userId + '">Talk</button>' +
                    '<button class="block-btn" onclick="app.blockUser(\\'' + userName + '\\')">Block</button>' +
                    '<div class="user-recordings-link" onclick="app.showUserRecordings(\\'' + userName + '\\')" style="margin-top: 10px; cursor: pointer; color: #3498db; font-size: 12px;">View Recordings</div>';

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

            addRecordingToUI(recording) {
                const recordingId = recording.recordingId || ('rec-' + Date.now());
                this.recordings.set(recordingId, recording);

                const recordingsList = document.getElementById('recordingsList');

                const existingRecording = document.getElementById(recordingId);
                if (existingRecording) return;

                const timestamp = new Date(recording.timestamp).toLocaleString();
                const audioBlob = recording.audioBlob ? this.base64ToBlob(recording.audioBlob) : null;
                const audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : null;
                
                const recordingItem = document.createElement('div');
                recordingItem.className = 'recording-item';
                recordingItem.id = recordingId;
                
                recordingItem.innerHTML = '<div class="recording-header">' +
                    '<div class="recording-info">' +
                    '<strong>From:</strong> ' + recording.from + '<br>' +
                    '<strong>To:</strong> ' + recording.to + '<br>' +
                    '<strong>Time:</strong> ' + timestamp +
                    '</div>' +
                    '<div class="recording-actions">' +
                    (audioUrl ? '<button class="play-btn" onclick="app.playRecording(\\'' + recordingId + '\\')">Play</button>' +
                    '<button class="download-btn" onclick="app.downloadRecording(\\'' + recordingId + '\\')">Download</button>' : '') +
                    '</div>' +
                    '</div>' +
                    (audioUrl ? '<audio controls class="audio-player" src="' + audioUrl + '"></audio>' : '');

                recordingsList.appendChild(recordingItem);
            }

            playRecording(recordingId) {
                const recording = this.recordings.get(recordingId);
                if (recording && recording.audioBlob) {
                    const audioElement = document.querySelector('#' + recordingId + ' audio');
                    if (audioElement) {
                        audioElement.play();
                    }
                }
            }

            downloadRecording(recordingId) {
                const recording = this.recordings.get(recordingId);
                if (recording && recording.audioBlob) {
                    const blob = this.base64ToBlob(recording.audioBlob);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    const timestamp = new Date(recording.timestamp).toISOString().replace(/[:.]/g, '-');
                    a.href = url;
                    a.download = 'walkie-talkie-' + recording.from + '-to-' + recording.to + '-' + timestamp + '.webm';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }
            }

            downloadAllRecordings() {
                if (this.recordings.size === 0) {
                    this.showMessage('No recordings to download');
                    return;
                }

                let downloadedCount = 0;
                this.recordings.forEach((recording, recordingId) => {
                    if (recording.audioBlob) {
                        this.downloadRecording(recordingId);
                        downloadedCount++;
                    }
                });

                this.showSuccess(downloadedCount + ' recordings downloaded');
            }

            showUserRecordings(userName) {
                const userRecordings = Array.from(this.recordings.entries())
                    .filter(([id, recording]) => recording.from === userName || recording.to === userName);
                
                this.showUserRecordingsModal(userName, userRecordings);
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
                
                let recordingsHTML = '';
                recordings.forEach(([id, recording]) => {
                    recordingsHTML += '<div class="recording-item">' +
                        '<strong>From:</strong> ' + recording.from + '<br>' +
                        '<strong>To:</strong> ' + recording.to + '<br>' +
                        '<strong>Time:</strong> ' + new Date(recording.timestamp).toLocaleString() +
                        '<button onclick="app.downloadRecording(\\'' + id + '\\')" style="margin-left: 10px;">Download</button>' +
                        '</div>';
                });
                
                modal.innerHTML = '<div style="background: white; padding: 20px; border-radius: 10px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;">' +
                    '<h2>Recordings for ' + userName + '</h2>' +
                    '<div id="userSpecificRecordings">' + recordingsHTML + '</div>' +
                    '<button onclick="this.closest(\\'div[style]\\').remove()" style="margin-top: 20px;">Close</button>' +
                    '</div>';
                
                document.body.appendChild(modal);
            }

            blockUser(userName) {
                if (this.roomCode) {
                    console.log('Blocking user:', userName);
                    this.socket.emit('block-user', {
                        roomCode: this.roomCode,
                        userName: userName
                    });
                }
            }

            showMessage(message) {
                console.log(message);
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
    console.log('Room created:', roomCode, 'by admin:', socket.id);
    socket.emit('room-created', { roomCode });
  });

  // User joins room
  socket.on('join-room', (data) => {
    const { roomCode, userName } = data;
    console.log('Join room attempt:', roomCode, 'by user:', userName);

    const room = rooms.get(roomCode);

    if (!room) {
      console.log('Room not found:', roomCode);
      socket.emit('error', { message: 'Room not found. Please check the room code.' });
      return;
    }

    if (room.blockedUsers.has(userName)) {
      console.log('User blocked from room:', userName);
      socket.emit('error', { message: 'You are blocked from this room' });
      return;
    }

    const existingUser = Array.from(room.users.values()).find(user => user.name === userName);
    if (existingUser) {
      console.log('User name already exists:', userName);
      socket.emit('error', { message: 'User name already exists in this room. Please choose a different name.' });
      return;
    }

    room.users.set(socket.id, {
      id: socket.id,
      name: userName,
      isTalking: false
    });

    if (!userRecordingSessions.has(userName)) {
      userRecordingSessions.set(userName, []);
    }

    socket.join(roomCode);
    console.log('User joined room:', userName, 'to room:', roomCode);
    socket.emit('room-joined', { roomCode, userName });
    
    socket.to(room.admin).emit('user-joined', {
      userId: socket.id,
      userName: userName
    });

    const users = Array.from(room.users.values());
    socket.to(room.admin).emit('users-update', users);
  });

  // Start talking (push-to-talk)
  socket.on('start-talking', (data) => {
    const { targetUserId, roomCode } = data;
    console.log('Start talking in room:', roomCode, 'from:', socket.id, 'to:', targetUserId);

    const room = rooms.get(roomCode);
    
    if (!room) {
      console.log('Room not found for talking:', roomCode);
      return;
    }

    const speaker = room.users.get(socket.id) || 
                   (socket.id === room.admin ? { id: socket.id, name: 'Admin', isTalking: true } : null);
    
    if (speaker) {
      speaker.isTalking = true;
      
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

      if (speaker.name !== 'Admin') {
        const userRecordings = userRecordingSessions.get(speaker.name) || [];
        userRecordings.push(recordingData);
        userRecordingSessions.set(speaker.name, userRecordings);
      }

      console.log('Recording started:', recordingId, 'From:', speaker.name, 'To:', targetUserId);

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
    console.log('Stop talking, recording:', recordingId);

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
          recording.audioBlob = audioBlob;
          recording.endTime = new Date();
          console.log('Recording saved:', recordingId, 'Duration:', (recording.endTime - recording.timestamp) + 'ms');

          if (recording.to === 'Admin') {
            io.to(room.admin).emit('recording-complete', {
              ...recording,
              to: recording.from
            });
          } else if (recording.to === 'All Users') {
            room.users.forEach((user, userId) => {
              io.to(userId).emit('recording-complete', {
                ...recording,
                to: 'You (All)'
              });
            });
            io.to(room.admin).emit('recording-complete', recording);
          } else {
            const targetUser = Array.from(room.users.entries()).find(([id, user]) => user.name === recording.to);
            if (targetUser) {
              const [targetUserId, targetUserData] = targetUser;
              io.to(targetUserId).emit('recording-complete', {
                ...recording,
                to: 'You'
              });
            }
            
            io.to(room.admin).emit('recording-complete', recording);
          }
        }

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
      console.log('Recording marked as downloaded:', recordingId);
    }
  });

  // Block user
  socket.on('block-user', (data) => {
    const { roomCode, userName } = data;
    console.log('Block user request:', userName, 'in room:', roomCode);
    
    const room = rooms.get(roomCode);
    
    if (room && socket.id === room.admin) {
      room.blockedUsers.add(userName);
      
      const userEntry = Array.from(room.users.entries()).find(([id, user]) => user.name === userName);
      if (userEntry) {
        const [userId, user] = userEntry;
        console.log('Disconnecting blocked user:', userName);
        
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
    console.log('User disconnected:', socket.id, 'Reason:', reason);
    
    for (const [roomCode, room] of rooms.entries()) {
      if (room.admin === socket.id) {
        console.log('Admin disconnected, closing room:', roomCode);
        
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
        const user = room.users.get(socket.id);
        room.users.delete(socket.id);
        console.log('User disconnected:', user.name, 'from room:', roomCode);
        
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
  console.log('User Page: http://localhost:' + PORT + '/');
  console.log('Admin Page: http://localhost:' + PORT + '/admin');
});
