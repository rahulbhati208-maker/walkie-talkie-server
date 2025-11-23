const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

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
                this.localStream = null;
                this.audioContext = null;
                this.mediaStreamSource = null;
                this.scriptProcessor = null;
                this.reconnectAttempts = 0;
                this.maxReconnectAttempts = 5;
                this.reconnectTimeout = null;
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

                this.testMicrophoneAccess();
            }

            async testMicrophoneAccess() {
                try {
                    this.localStream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                            channelCount: 1
                        } 
                    });
                    
                    // Initialize audio context for processing
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    
                    document.getElementById('micIndicator').classList.add('active');
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
                });

                this.socket.on('audio-data', (data) => {
                    this.playAudio(data.audioData);
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
                    this.showError('Room has been closed by admin');
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

            async startTalking(targetUserId) {
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

                // Start capturing and streaming audio
                await this.startAudioStreaming();

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

                // Stop audio streaming
                this.stopAudioStreaming();

                this.socket.emit('stop-talking', {
                    roomCode: this.roomCode
                });
            }

            async startAudioStreaming() {
                try {
                    if (!this.localStream) {
                        this.localStream = await navigator.mediaDevices.getUserMedia({ 
                            audio: {
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true,
                                channelCount: 1
                            } 
                        });
                    }

                    if (!this.audioContext) {
                        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    }

                    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.localStream);
                    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

                    this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                        if (this.isTalking) {
                            const inputBuffer = audioProcessingEvent.inputBuffer;
                            const inputData = inputBuffer.getChannelData(0);
                            
                            // Convert Float32Array to Int16Array for smaller data size
                            const int16Data = new Int16Array(inputData.length);
                            for (let i = 0; i < inputData.length; i++) {
                                int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
                            }
                            
                            // Send audio data via socket
                            this.socket.emit('audio-data', {
                                roomCode: this.roomCode,
                                audioData: Array.from(int16Data),
                                sampleRate: this.audioContext.sampleRate
                            });
                        }
                    };

                    this.mediaStreamSource.connect(this.scriptProcessor);
                    this.scriptProcessor.connect(this.audioContext.destination);
                    
                    console.log('Audio streaming started');
                } catch (error) {
                    console.error('Error starting audio streaming:', error);
                    this.showError('Could not access microphone. Please check permissions.');
                }
            }

            stopAudioStreaming() {
                if (this.scriptProcessor) {
                    this.scriptProcessor.disconnect();
                    this.scriptProcessor = null;
                }
                if (this.mediaStreamSource) {
                    this.mediaStreamSource.disconnect();
                    this.mediaStreamSource = null;
                }
                console.log('Audio streaming stopped');
            }

            playAudio(audioData) {
                try {
                    if (!this.audioContext) {
                        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    }

                    const int16Data = new Int16Array(audioData);
                    const float32Data = new Float32Array(int16Data.length);
                    
                    // Convert Int16Array back to Float32Array
                    for (let i = 0; i < int16Data.length; i++) {
                        float32Data[i] = int16Data[i] / 32768;
                    }

                    const audioBuffer = this.audioContext.createBuffer(1, float32Data.length, this.audioContext.sampleRate);
                    audioBuffer.getChannelData(0).set(float32Data);

                    const source = this.audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(this.audioContext.destination);
                    source.start();
                    
                    console.log('Playing received audio');
                } catch (error) {
                    console.error('Error playing audio:', error);
                }
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
                    '<button class="block-btn" onclick="app.blockUser(\\'' + userName + '\\')">Block</button>';

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
                        if (isTalking && userId !== this.socket.id) {
                            userCard.classList.add('talking');
                        } else {
                            userCard.classList.remove('talking');
                        }
                        
                        // Make user glow when admin is talking to them
                        if (isTalking && targetUserId === userId) {
                            userCard.classList.add('receiving');
                        } else {
                            userCard.classList.remove('receiving');
                        }
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
                    console.log('Blocking user:', userName);
                    this.socket.emit('block-user', {
                        roomCode: this.roomCode,
                        userName: userName
                    });
                }
            }

            leaveRoom() {
                this.stopAudioStreaming();
                
                if (this.localStream) {
                    this.localStream.getTracks().forEach(track => track.stop());
                    this.localStream = null;
                }

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
        // Admin-specific JavaScript
        class WalkieTalkieApp {
            constructor() {
                this.socket = null;
                this.roomCode = null;
                this.userName = 'Admin';
                this.isAdmin = true;
                this.isTalking = false;
                this.localStream = null;
                this.audioContext = null;
                this.mediaStreamSource = null;
                this.scriptProcessor = null;
                this.reconnectAttempts = 0;
                this.maxReconnectAttempts = 5;
                this.reconnectTimeout = null;
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
            }

            setupSocketListeners() {
                this.socket.on('room-created', (data) => {
                    console.log('Room created:', data.roomCode);
                    this.roomCode = data.roomCode;
                    document.getElementById('roomCode').textContent = data.roomCode;
                    this.showSuccess('Room created with code: ' + data.roomCode);
                    document.getElementById('talkToAllBtn').disabled = false;
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
                });

                this.socket.on('audio-data', (data) => {
                    this.playAudio(data.audioData);
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

            async startTalking(targetUserId) {
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

                // Start capturing and streaming audio
                await this.startAudioStreaming();

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

                // Stop audio streaming
                this.stopAudioStreaming();

                this.socket.emit('stop-talking', {
                    roomCode: this.roomCode
                });
            }

            async startAudioStreaming() {
                try {
                    if (!this.localStream) {
                        this.localStream = await navigator.mediaDevices.getUserMedia({ 
                            audio: {
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true,
                                channelCount: 1
                            } 
                        });
                    }

                    if (!this.audioContext) {
                        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    }

                    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.localStream);
                    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

                    this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                        if (this.isTalking) {
                            const inputBuffer = audioProcessingEvent.inputBuffer;
                            const inputData = inputBuffer.getChannelData(0);
                            
                            // Convert Float32Array to Int16Array for smaller data size
                            const int16Data = new Int16Array(inputData.length);
                            for (let i = 0; i < inputData.length; i++) {
                                int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
                            }
                            
                            // Send audio data via socket
                            this.socket.emit('audio-data', {
                                roomCode: this.roomCode,
                                audioData: Array.from(int16Data),
                                sampleRate: this.audioContext.sampleRate
                            });
                        }
                    };

                    this.mediaStreamSource.connect(this.scriptProcessor);
                    this.scriptProcessor.connect(this.audioContext.destination);
                    
                    console.log('Audio streaming started');
                } catch (error) {
                    console.error('Error starting audio streaming:', error);
                    this.showError('Could not access microphone. Please check permissions.');
                }
            }

            stopAudioStreaming() {
                if (this.scriptProcessor) {
                    this.scriptProcessor.disconnect();
                    this.scriptProcessor = null;
                }
                if (this.mediaStreamSource) {
                    this.mediaStreamSource.disconnect();
                    this.mediaStreamSource = null;
                }
                console.log('Audio streaming stopped');
            }

            playAudio(audioData) {
                try {
                    if (!this.audioContext) {
                        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    }

                    const int16Data = new Int16Array(audioData);
                    const float32Data = new Float32Array(int16Data.length);
                    
                    // Convert Int16Array back to Float32Array
                    for (let i = 0; i < int16Data.length; i++) {
                        float32Data[i] = int16Data[i] / 32768;
                    }

                    const audioBuffer = this.audioContext.createBuffer(1, float32Data.length, this.audioContext.sampleRate);
                    audioBuffer.getChannelData(0).set(float32Data);

                    const source = this.audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(this.audioContext.destination);
                    source.start();
                    
                    console.log('Playing received audio');
                } catch (error) {
                    console.error('Error playing audio:', error);
                }
            }

            addUserToUI(userId, userName) {
                const usersList = document.getElementById('usersList');

                const userCard = document.createElement('div');
                userCard.className = 'user-card';
                userCard.id = 'user-' + userId;
                userCard.innerHTML = '<div class="user-avatar">' + userName.charAt(0).toUpperCase() + '</div>' +
                    '<div class="user-name">' + userName + '</div>' +
                    '<button class="individual-talk-btn" id="talk-btn-' + userId + '">Talk</button>' +
                    '<button class="block-btn" onclick="app.blockUser(\\'' + userName + '\\')">Block</button>';

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
                    if (isTalking && userId !== this.socket.id) {
                        userCard.classList.add('talking');
                    } else {
                        userCard.classList.remove('talking');
                    }
                    
                    // Make user glow when admin is talking to them
                    if (isTalking && targetUserId === userId) {
                        userCard.classList.add('receiving');
                    } else {
                        userCard.classList.remove('receiving');
                    }
                }
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

      console.log('User started talking:', speaker.name, 'to:', targetUserId);

      // Notify all in room about who is talking to whom
      io.to(roomCode).emit('user-talking', {
        userId: socket.id,
        targetUserId: targetUserId,
        isTalking: true
      });
    }
  });

  // Stop talking
  socket.on('stop-talking', (data) => {
    const { roomCode } = data;
    console.log('Stop talking in room:', roomCode);

    const room = rooms.get(roomCode);
    
    if (room) {
      const speaker = room.users.get(socket.id) || 
                     (socket.id === room.admin ? { id: socket.id, name: 'Admin' } : null);
      
      if (speaker) {
        speaker.isTalking = false;

        // Notify all to stop talking indicators
        io.to(roomCode).emit('user-talking', {
          userId: socket.id,
          isTalking: false
        });
      }
    }
  });

  // Audio data streaming
  socket.on('audio-data', (data) => {
    const { roomCode, audioData, sampleRate } = data;
    console.log('Received audio data for room:', roomCode, 'data length:', audioData.length);

    const room = rooms.get(roomCode);
    if (room) {
      // Broadcast audio to all users in the room except sender
      socket.to(roomCode).emit('audio-data', {
        audioData: audioData,
        sampleRate: sampleRate
      });
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
        
        io.to(userId).emit('blocked', { message: 'You have been blocked by admin' });
        room.users.delete(userId);
        socket.to(room.admin).emit('users-update', Array.from(room.users.values()));
      }
    }
  });

  // Disconnection handling
  socket.on('disconnect', (reason) => {
    console.log('User disconnected:', socket.id, 'Reason:', reason);
    
    for (const [roomCode, room] of rooms.entries()) {
      if (room.admin === socket.id) {
        console.log('Admin disconnected, closing room:', roomCode);
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
