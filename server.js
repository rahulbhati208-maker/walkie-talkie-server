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
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: #f5f5f5; 
            min-height: 100vh; 
            padding: 20px; 
        }
        .container { 
            max-width: 400px; 
            margin: 0 auto; 
            background: white; 
            border-radius: 12px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
            overflow: hidden; 
        }
        .header { 
            background: #2c3e50; 
            color: white; 
            padding: 20px; 
            text-align: center; 
        }
        .connection-status { 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            gap: 8px; 
            margin-top: 8px; 
            font-size: 13px; 
        }
        .status-dot { 
            width: 8px; 
            height: 8px; 
            border-radius: 50%; 
            background: #95a5a6; 
        }
        .status-dot.connected { background: #27ae60; }
        .status-dot.reconnecting { background: #f39c12; animation: pulse 1s infinite; }
        @keyframes pulse { 
            0% { opacity: 1; } 
            50% { opacity: 0.5; } 
            100% { opacity: 1; } 
        }
        .join-section, .chat-section { padding: 24px; }
        .input-group { display: flex; flex-direction: column; gap: 12px; margin: 16px 0; }
        input { 
            padding: 12px; 
            border: 1px solid #ddd; 
            border-radius: 6px; 
            font-size: 14px; 
            background: #fafafa;
        }
        input:focus { 
            outline: none; 
            border-color: #3498db; 
            background: white;
        }
        button { 
            background: #3498db; 
            color: white; 
            border: none; 
            padding: 12px 20px; 
            border-radius: 6px; 
            cursor: pointer; 
            font-size: 14px; 
            transition: all 0.2s ease; 
        }
        button:hover { background: #2980b9; }
        button:disabled { background: #bdc3c7; cursor: not-allowed; }
        .talk-btn { 
            background: #27ae60; 
            font-size: 16px; 
            font-weight: 600; 
            padding: 16px; 
            width: 120px; 
            height: 120px; 
            border-radius: 50%; 
            margin: 20px auto; 
            display: block; 
        }
        .talk-btn.talking { 
            background: #e74c3c; 
        }
        .talk-btn:disabled { background: #bdc3c7; }
        .hidden { display: none; }
        .error-message { 
            background: #e74c3c; 
            color: white; 
            padding: 12px; 
            border-radius: 6px; 
            margin: 12px 0; 
            text-align: center; 
            font-size: 13px;
        }
        .success-message { 
            background: #27ae60; 
            color: white; 
            padding: 12px; 
            border-radius: 6px; 
            margin: 12px 0; 
            text-align: center; 
            font-size: 13px;
        }
        .status-indicators { 
            display: flex; 
            justify-content: center; 
            gap: 24px; 
            margin: 16px 0; 
        }
        .status-item { 
            display: flex; 
            align-items: center; 
            gap: 8px; 
            font-size: 13px;
            color: #666;
        }
        .status-dot { 
            width: 12px; 
            height: 12px; 
            border-radius: 50%; 
            background: #bdc3c7; 
        }
        .status-dot.active { background: #27ae60; }
        .admin-status.active { background: #e74c3c; }
        .user-info { 
            text-align: center; 
            margin-bottom: 16px; 
            padding: 12px; 
            background: #f8f9fa; 
            border-radius: 6px; 
            font-size: 13px;
            color: #555;
        }
        .mic-indicator { 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            gap: 8px; 
            margin: 12px 0; 
            font-size: 13px;
            color: #666;
        }
        .mic-dot { 
            width: 10px; 
            height: 10px; 
            border-radius: 50%; 
            background: #e74c3c; 
        }
        .mic-dot.active { background: #27ae60; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="font-size: 20px; margin-bottom: 8px;">Walkie Talkie</h1>
            <div class="connection-status">
                <div class="status-dot" id="connectionStatus"></div>
                <span id="connectionText">Connecting...</span>
            </div>
        </div>
        <div class="join-section" id="joinSection">
            <h2 style="font-size: 16px; color: #2c3e50; margin-bottom: 16px; text-align: center;">Join Room</h2>
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
                <span>Microphone Ready</span>
            </div>
            
            <button id="talkBtn" class="talk-btn" disabled>Click to Talk</button>
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
                this.mediaRecorder = null;
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
                document.getElementById('talkToAllBtn').addEventListener('click', () => this.toggleTalking('all'));
                
                // Test microphone for admin too
                this.testMicrophoneAccess();
            }

            initUser() {
                document.getElementById('joinRoomBtn').addEventListener('click', () => this.joinRoom());
                document.getElementById('talkBtn').addEventListener('click', () => this.toggleTalking('admin'));
                
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
                            channelCount: 1,
                            sampleRate: 16000
                        } 
                    });
                    
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

                this.socket.on('audio-stream', (data) => {
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

            toggleTalking(targetUserId) {
                if (!this.roomCode || !this.socket.connected) {
                    this.showError('Not connected to room');
                    return;
                }
                
                if (this.isTalking) {
                    this.stopTalking();
                } else {
                    this.startTalking(targetUserId);
                }
            }

            async startTalking(targetUserId) {
                console.log('Start talking to:', targetUserId);
                this.isTalking = true;
                
                if (this.isAdmin) {
                    const talkBtn = targetUserId === 'all' ? 
                        document.getElementById('talkToAllBtn') : 
                        document.getElementById('talk-btn-' + targetUserId);
                    if (talkBtn) {
                        talkBtn.classList.add('talking');
                        talkBtn.textContent = targetUserId === 'all' ? 'Stop Talking to All' : 'Stop Talking';
                    }
                } else {
                    document.getElementById('talkBtn').classList.add('talking');
                    document.getElementById('talkBtn').textContent = 'Stop Talking';
                    document.getElementById('userStatus').classList.add('active');
                }

                // Start audio streaming
                await this.startAudioStreaming();

                this.socket.emit('start-talking', {
                    targetUserId: targetUserId,
                    roomCode: this.roomCode
                });
            }

            stopTalking() {
                console.log('Stop talking');
                this.isTalking = false;
                
                if (this.isAdmin) {
                    document.querySelectorAll('.talk-btn').forEach(btn => {
                        btn.classList.remove('talking');
                        if (btn.id === 'talkToAllBtn') {
                            btn.textContent = 'Talk to All Users';
                        } else if (btn.id.startsWith('talk-btn-')) {
                            btn.textContent = 'Talk';
                        }
                    });
                } else {
                    document.getElementById('talkBtn').classList.remove('talking');
                    document.getElementById('talkBtn').textContent = 'Click to Talk';
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
                                channelCount: 1,
                                sampleRate: 16000
                            } 
                        });
                    }

                    // Use MediaRecorder for better audio quality
                    this.mediaRecorder = new MediaRecorder(this.localStream, {
                        mimeType: 'audio/webm;codecs=opus'
                    });

                    let audioChunks = [];
                    
                    this.mediaRecorder.ondataavailable = (event) => {
                        if (event.data.size > 0) {
                            audioChunks.push(event.data);
                            
                            // Convert to base64 and send
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                this.socket.emit('audio-stream', {
                                    roomCode: this.roomCode,
                                    audioData: reader.result
                                });
                            };
                            reader.readAsDataURL(event.data);
                        }
                    };

                    this.mediaRecorder.start(100); // Collect data every 100ms
                    
                    console.log('Audio streaming started');
                } catch (error) {
                    console.error('Error starting audio streaming:', error);
                    this.showError('Could not access microphone. Please check permissions.');
                }
            }

            stopAudioStreaming() {
                if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                    this.mediaRecorder.stop();
                }
                console.log('Audio streaming stopped');
            }

            playAudio(audioData) {
                try {
                    // Convert base64 to blob
                    const byteString = atob(audioData.split(',')[1]);
                    const mimeString = audioData.split(',')[0].split(':')[1].split(';')[0];
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    
                    for (let i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }
                    
                    const blob = new Blob([ab], { type: mimeString });
                    const audioUrl = URL.createObjectURL(blob);
                    
                    const audio = new Audio(audioUrl);
                    audio.play().catch(e => console.log('Audio play failed:', e));
                    
                    console.log('Playing received audio');
                } catch (error) {
                    console.error('Error playing audio:', error);
                }
            }

            addUserToUI(userId, userName) {
                if (!this.isAdmin) return;

                const usersList = document.getElementById('usersList');

                const userCircle = document.createElement('div');
                userCircle.className = 'user-circle';
                userCircle.id = 'user-' + userId;
                userCircle.innerHTML = '<div class="user-avatar">' + userName.charAt(0).toUpperCase() + '</div>' +
                    '<div class="user-name">' + userName + '</div>' +
                    '<div class="user-status online"></div>' +
                    '<button class="talk-user-btn" id="talk-btn-' + userId + '">Talk</button>' +
                    '<button class="block-btn" onclick="app.toggleBlockUser(\\'' + userName + '\\')">Block</button>';

                usersList.appendChild(userCircle);

                const talkBtn = document.getElementById('talk-btn-' + userId);
                talkBtn.addEventListener('click', () => this.toggleTalking(userId));
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
                    const userCircle = document.getElementById('user-' + userId);
                    if (userCircle) {
                        // User is talking (green)
                        if (isTalking && userId !== this.socket.id) {
                            userCircle.classList.add('talking');
                        } else {
                            userCircle.classList.remove('talking');
                        }
                        
                        // Admin is talking to this user (red)
                        if (isTalking && targetUserId === userId) {
                            userCircle.classList.add('receiving');
                        } else {
                            userCircle.classList.remove('receiving');
                        }
                    }
                } else {
                    const adminStatus = document.getElementById('adminStatus');
                    if (adminStatus) {
                        adminStatus.classList.toggle('active', isTalking && userId !== this.socket.id);
                    }
                }
            }

            toggleBlockUser(userName) {
                if (this.isAdmin && this.roomCode) {
                    console.log('Toggling block for user:', userName);
                    this.socket.emit('toggle-block-user', {
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
                    document.getElementById('talkToAllBtn').textContent = 'Talk to All Users';
                } else {
                    document.getElementById('joinSection').classList.remove('hidden');
                    document.getElementById('chatSection').classList.add('hidden');
                    document.getElementById('talkBtn').disabled = true;
                    document.getElementById('talkBtn').textContent = 'Click to Talk';
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
                    }, 3000);
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
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: #f5f5f5; 
            min-height: 100vh; 
            padding: 20px; 
        }
        .container { 
            max-width: 800px; 
            margin: 0 auto; 
            background: white; 
            border-radius: 12px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
            overflow: hidden; 
        }
        .header { 
            background: #2c3e50; 
            color: white; 
            padding: 20px; 
            text-align: center; 
        }
        .connection-status { 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            gap: 8px; 
            margin-top: 8px; 
            font-size: 13px; 
        }
        .status-dot { 
            width: 8px; 
            height: 8px; 
            border-radius: 50%; 
            background: #95a5a6; 
        }
        .status-dot.connected { background: #27ae60; }
        .status-dot.reconnecting { background: #f39c12; animation: pulse 1s infinite; }
        @keyframes pulse { 
            0% { opacity: 1; } 
            50% { opacity: 0.5; } 
            100% { opacity: 1; } 
        }
        .room-info { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            margin-top: 12px; 
            flex-wrap: wrap; 
            gap: 12px;
        }
        #roomCode { 
            font-size: 24px; 
            font-weight: bold; 
            color: #f39c12; 
            background: rgba(255,255,255,0.1); 
            padding: 8px 16px; 
            border-radius: 6px; 
        }
        button { 
            background: #3498db; 
            color: white; 
            border: none; 
            padding: 10px 16px; 
            border-radius: 6px; 
            cursor: pointer; 
            font-size: 13px; 
            transition: all 0.2s ease; 
        }
        button:hover { background: #2980b9; }
        button:active { transform: translateY(0); }
        button:disabled { background: #bdc3c7; cursor: not-allowed; }
        .talk-btn { 
            background: #27ae60; 
            font-size: 14px; 
            font-weight: 600; 
            padding: 12px 16px; 
        }
        .talk-btn.talking { 
            background: #e74c3c; 
        }
        .talk-btn:disabled { background: #bdc3c7; }
        .users-container, .controls { 
            padding: 20px; 
            border-bottom: 1px solid #ecf0f1; 
        }
        .users-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); 
            gap: 12px; 
            margin-top: 12px; 
        }
        .user-circle { 
            background: #f8f9fa; 
            border: 2px solid #e9ecef; 
            border-radius: 50%; 
            padding: 16px; 
            text-align: center; 
            position: relative;
            transition: all 0.3s ease; 
            width: 80px;
            height: 80px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }
        .user-circle.talking { 
            border-color: #27ae60; 
            background: #d5f4e6; 
        }
        .user-circle.receiving { 
            border-color: #e74c3c; 
            background: #fadbd8; 
            animation: glow-red 1s infinite; 
        }
        @keyframes glow-red { 
            0% { box-shadow: 0 0 5px #e74c3c; } 
            50% { box-shadow: 0 0 15px #e74c3c; } 
            100% { box-shadow: 0 0 5px #e74c3c; } 
        }
        .user-avatar { 
            font-size: 16px; 
            font-weight: bold; 
            color: #2c3e50;
            margin-bottom: 4px;
        }
        .user-name { 
            font-weight: 600; 
            font-size: 11px;
            color: #2c3e50;
            margin-bottom: 4px;
        }
        .user-status {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #27ae60;
            position: absolute;
            top: 8px;
            right: 8px;
        }
        .user-status.offline {
            background: #bdc3c7;
        }
        .user-controls {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-top: 4px;
        }
        .talk-user-btn, .block-btn { 
            padding: 4px 8px; 
            font-size: 10px; 
            border-radius: 4px;
        }
        .talk-user-btn { 
            background: #9b59b6; 
        }
        .talk-user-btn:hover {
            background: #8e44ad;
        }
        .block-btn { 
            background: #e74c3c; 
        }
        .block-btn:hover {
            background: #c0392b;
        }
        .block-btn.blocked {
            background: #95a5a6;
        }
        .hidden { display: none !important; }
        .error-message { 
            background: #e74c3c; 
            color: white; 
            padding: 12px; 
            border-radius: 6px; 
            margin: 12px; 
            text-align: center; 
            font-size: 13px;
        }
        .success-message { 
            background: #27ae60; 
            color: white; 
            padding: 12px; 
            border-radius: 6px; 
            margin: 12px; 
            text-align: center; 
            font-size: 13px;
        }
        @media (max-width: 768px) { 
            .container { margin: 10px; border-radius: 8px; } 
            .room-info { flex-direction: column; gap: 12px; } 
            .users-grid { grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); } 
        }
        h2 {
            font-size: 16px;
            color: #2c3e50;
            margin-bottom: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="font-size: 20px; margin-bottom: 8px;">Walkie Talkie Admin</h1>
            <div class="connection-status">
                <div class="status-dot" id="connectionStatus"></div>
                <span id="connectionText">Connecting...</span>
            </div>
            <div class="room-info">
                <div>Room Code: <span id="roomCode">----</span></div>
                <button id="createRoomBtn" disabled>Create New Room</button>
            </div>
        </div>

        <div class="users-container">
            <h2>Connected Users</h2>
            <div id="usersList" class="users-grid"></div>
        </div>

        <div class="controls">
            <h2>Admin Controls</h2>
            <div class="talk-controls">
                <button id="talkToAllBtn" class="talk-btn" disabled>Talk to All Users</button>
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
                this.mediaRecorder = null;
                this.reconnectAttempts = 0;
                this.maxReconnectAttempts = 5;
                this.reconnectTimeout = null;
                this.blockedUsers = new Set();
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
                document.getElementById('talkToAllBtn').addEventListener('click', () => this.toggleTalking('all'));
                
                this.testMicrophoneAccess();
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

                this.socket.on('audio-stream', (data) => {
                    this.playAudio(data.audioData);
                });

                this.socket.on('user-left', (data) => {
                    console.log('User left:', data.userName);
                    this.removeUserFromUI(data.userId);
                    this.showMessage('User ' + data.userName + ' left the room');
                });

                this.socket.on('user-blocked', (data) => {
                    this.blockedUsers.add(data.userName);
                    this.updateBlockButton(data.userName, true);
                    this.showSuccess('User ' + data.userName + ' has been blocked');
                });

                this.socket.on('user-unblocked', (data) => {
                    this.blockedUsers.delete(data.userName);
                    this.updateBlockButton(data.userName, false);
                    this.showSuccess('User ' + data.userName + ' has been unblocked');
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

            toggleTalking(targetUserId) {
                if (!this.roomCode || !this.socket.connected) {
                    this.showError('Not connected to room');
                    return;
                }
                
                if (this.isTalking) {
                    this.stopTalking();
                } else {
                    this.startTalking(targetUserId);
                }
            }

            async startTalking(targetUserId) {
                console.log('Start talking to:', targetUserId);
                this.isTalking = true;
                
                const talkBtn = targetUserId === 'all' ? 
                    document.getElementById('talkToAllBtn') : 
                    document.getElementById('talk-btn-' + targetUserId);
                if (talkBtn) {
                    talkBtn.classList.add('talking');
                    talkBtn.textContent = targetUserId === 'all' ? 'Stop Talking to All' : 'Stop Talking';
                }

                // Start audio streaming
                await this.startAudioStreaming();

                this.socket.emit('start-talking', {
                    targetUserId: targetUserId,
                    roomCode: this.roomCode
                });
            }

            stopTalking() {
                console.log('Stop talking');
                this.isTalking = false;
                
                document.querySelectorAll('.talk-btn').forEach(btn => {
                    btn.classList.remove('talking');
                    if (btn.id === 'talkToAllBtn') {
                        btn.textContent = 'Talk to All Users';
                    } else if (btn.id.startsWith('talk-btn-')) {
                        btn.textContent = 'Talk';
                    }
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
                                channelCount: 1,
                                sampleRate: 16000
                            } 
                        });
                    }

                    // Use MediaRecorder for better audio quality
                    this.mediaRecorder = new MediaRecorder(this.localStream, {
                        mimeType: 'audio/webm;codecs=opus'
                    });

                    let audioChunks = [];
                    
                    this.mediaRecorder.ondataavailable = (event) => {
                        if (event.data.size > 0) {
                            audioChunks.push(event.data);
                            
                            // Convert to base64 and send
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                this.socket.emit('audio-stream', {
                                    roomCode: this.roomCode,
                                    audioData: reader.result
                                });
                            };
                            reader.readAsDataURL(event.data);
                        }
                    };

                    this.mediaRecorder.start(100); // Collect data every 100ms
                    
                    console.log('Audio streaming started');
                } catch (error) {
                    console.error('Error starting audio streaming:', error);
                    this.showError('Could not access microphone. Please check permissions.');
                }
            }

            stopAudioStreaming() {
                if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                    this.mediaRecorder.stop();
                }
                console.log('Audio streaming stopped');
            }

            playAudio(audioData) {
                try {
                    // Convert base64 to blob
                    const byteString = atob(audioData.split(',')[1]);
                    const mimeString = audioData.split(',')[0].split(':')[1].split(';')[0];
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    
                    for (let i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }
                    
                    const blob = new Blob([ab], { type: mimeString });
                    const audioUrl = URL.createObjectURL(blob);
                    
                    const audio = new Audio(audioUrl);
                    audio.play().catch(e => console.log('Audio play failed:', e));
                    
                    console.log('Playing received audio');
                } catch (error) {
                    console.error('Error playing audio:', error);
                }
            }

            addUserToUI(userId, userName) {
                const usersList = document.getElementById('usersList');

                const userCircle = document.createElement('div');
                userCircle.className = 'user-circle';
                userCircle.id = 'user-' + userId;
                userCircle.innerHTML = '<div class="user-avatar">' + userName.charAt(0).toUpperCase() + '</div>' +
                    '<div class="user-name">' + userName + '</div>' +
                    '<div class="user-status online"></div>' +
                    '<div class="user-controls">' +
                    '<button class="talk-user-btn" id="talk-btn-' + userId + '">Talk</button>' +
                    '<button class="block-btn" id="block-btn-' + userName + '">Block</button>' +
                    '</div>';

                usersList.appendChild(userCircle);

                const talkBtn = document.getElementById('talk-btn-' + userId);
                talkBtn.addEventListener('click', () => this.toggleTalking(userId));

                const blockBtn = document.getElementById('block-btn-' + userName);
                blockBtn.addEventListener('click', () => this.toggleBlockUser(userName));
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
                const userCircle = document.getElementById('user-' + userId);
                if (userCircle) {
                    // User is talking (green)
                    if (isTalking && userId !== this.socket.id) {
                        userCircle.classList.add('talking');
                    } else {
                        userCircle.classList.remove('talking');
                    }
                    
                    // Admin is talking to this user (red)
                    if (isTalking && targetUserId === userId) {
                        userCircle.classList.add('receiving');
                    } else {
                        userCircle.classList.remove('receiving');
                    }
                }
            }

            toggleBlockUser(userName) {
                if (this.roomCode) {
                    console.log('Toggling block for user:', userName);
                    this.socket.emit('toggle-block-user', {
                        roomCode: this.roomCode,
                        userName: userName
                    });
                }
            }

            updateBlockButton(userName, isBlocked) {
                const blockBtn = document.getElementById('block-btn-' + userName);
                if (blockBtn) {
                    if (isBlocked) {
                        blockBtn.textContent = 'Unblock';
                        blockBtn.classList.add('blocked');
                    } else {
                        blockBtn.textContent = 'Block';
                        blockBtn.classList.remove('blocked');
                    }
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
                    }, 3000);
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

  // Audio streaming
  socket.on('audio-stream', (data) => {
    const { roomCode, audioData } = data;
    console.log('Received audio data for room:', roomCode);

    const room = rooms.get(roomCode);
    if (room) {
      // Broadcast audio to all users in the room except sender
      socket.to(roomCode).emit('audio-stream', {
        audioData: audioData
      });
    }
  });

  // Toggle block user
  socket.on('toggle-block-user', (data) => {
    const { roomCode, userName } = data;
    console.log('Toggle block user request:', userName, 'in room:', roomCode);
    
    const room = rooms.get(roomCode);
    
    if (room && socket.id === room.admin) {
      if (room.blockedUsers.has(userName)) {
        // Unblock user
        room.blockedUsers.delete(userName);
        socket.emit('user-unblocked', { userName: userName });
        console.log('User unblocked:', userName);
      } else {
        // Block user
        room.blockedUsers.add(userName);
        
        // Find and disconnect blocked user
        const userEntry = Array.from(room.users.entries()).find(([id, user]) => user.name === userName);
        if (userEntry) {
          const [userId, user] = userEntry;
          console.log('Disconnecting blocked user:', userName);
          
          io.to(userId).emit('blocked', { message: 'You have been blocked by admin' });
          room.users.delete(userId);
          socket.to(room.admin).emit('users-update', Array.from(room.users.values()));
        }
        
        socket.emit('user-blocked', { userName: userName });
        console.log('User blocked:', userName);
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
