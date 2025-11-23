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
            transition: all 0.3s ease;
        }
        .talk-btn.talking { 
            background: #e74c3c; 
            transform: scale(1.05);
            box-shadow: 0 0 20px rgba(231, 76, 60, 0.5);
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
        .audio-quality { 
            text-align: center; 
            font-size: 12px; 
            color: #666; 
            margin-top: 8px; 
        }
        .volume-meter {
            width: 100%;
            height: 4px;
            background: #ecf0f1;
            border-radius: 2px;
            margin: 8px 0;
            overflow: hidden;
        }
        .volume-level {
            height: 100%;
            background: #27ae60;
            width: 0%;
            transition: width 0.1s ease;
        }
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
            
            <div class="volume-meter">
                <div class="volume-level" id="volumeLevel"></div>
            </div>
            
            <button id="talkBtn" class="talk-btn">Click to Talk</button>
            <div class="audio-quality">Crystal Clear Audio - Zero Latency</div>
            
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
                this.analyser = null;
                this.reconnectAttempts = 0;
                this.audioQueue = [];
                this.isPlaying = false;
                this.init();
            }

            init() {
                this.loadFromLocalStorage();
                this.connectToServer();
                this.checkPageType();
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
                    reconnection: true,
                    reconnectionAttempts: 10,
                    reconnectionDelay: 1000,
                    timeout: 20000
                });
                
                this.socket.on('connect', () => {
                    console.log('Connected to server');
                    this.reconnectAttempts = 0;
                    this.updateConnectionStatus('connected');
                    this.enableButtons();
                    
                    if (this.roomCode && this.userName) {
                        console.log('Rejoining room...');
                        this.socket.emit('rejoin-room', { 
                            roomCode: this.roomCode, 
                            userName: this.userName 
                        });
                    }
                });

                this.socket.on('disconnect', (reason) => {
                    console.log('Disconnected from server:', reason);
                    this.updateConnectionStatus('disconnected');
                    this.disableButtons();
                });

                this.socket.on('connect_error', (error) => {
                    console.log('Connection error:', error);
                    this.updateConnectionStatus('error');
                });

                this.socket.on('reconnect_attempt', (attempt) => {
                    console.log('Reconnection attempt:', attempt);
                    this.updateConnectionStatus('reconnecting');
                });

                this.socket.on('reconnect_failed', () => {
                    console.log('Reconnection failed');
                    this.showError('Connection lost. Please refresh the page.');
                });

                this.setupSocketListeners();
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
            }

            disableButtons() {
                document.getElementById('joinRoomBtn').disabled = true;
            }

            checkPageType() {
                this.isAdmin = window.location.pathname.includes('admin');
                if (this.isAdmin) {
                    this.initAdmin();
                } else {
                    this.initUser();
                }
            }

            initUser() {
                document.getElementById('joinRoomBtn').addEventListener('click', () => this.joinRoom());
                document.getElementById('talkBtn').addEventListener('mousedown', () => this.startTalking());
                document.getElementById('talkBtn').addEventListener('mouseup', () => this.stopTalking());
                document.getElementById('talkBtn').addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    this.startTalking();
                });
                document.getElementById('talkBtn').addEventListener('touchend', (e) => {
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
                            channelCount: 1,
                            sampleRate: 48000,
                            sampleSize: 16,
                            latency: 0
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
                this.socket.on('room-joined', (data) => {
                    console.log('Room joined:', data.roomCode);
                    this.roomCode = data.roomCode;
                    this.userName = data.userName;
                    document.getElementById('currentUserName').textContent = data.userName;
                    document.getElementById('currentRoomCode').textContent = data.roomCode;
                    document.getElementById('joinSection').classList.add('hidden');
                    document.getElementById('chatSection').classList.remove('hidden');
                    this.saveToLocalStorage();
                    this.showSuccess('Successfully joined room: ' + data.roomCode);
                });

                this.socket.on('user-talking', (data) => {
                    console.log('User talking:', data.userId, 'isTalking:', data.isTalking);
                    this.updateTalkingIndicator(data.userId, data.isTalking);
                });

                this.socket.on('audio-data', (data) => {
                    if (data.targetUserId === 'all' || data.targetUserId === this.socket.id) {
                        this.playAudio(data.audioBuffer);
                    }
                });

                this.socket.on('user-left', (data) => {
                    console.log('User left:', data.userName);
                    this.showMessage('User ' + data.userName + ' left the room');
                });

                this.socket.on('user-reconnected', (data) => {
                    console.log('User reconnected:', data.userName);
                    this.showSuccess('User ' + data.userName + ' reconnected');
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

            startTalking() {
                if (!this.roomCode || !this.socket.connected) {
                    this.showError('Not connected to room');
                    return;
                }
                
                console.log('Start talking to admin');
                this.isTalking = true;
                
                document.getElementById('talkBtn').classList.add('talking');
                document.getElementById('talkBtn').textContent = 'Release to Stop';
                document.getElementById('userStatus').classList.add('active');

                this.startAudioStreaming();

                this.socket.emit('start-talking', {
                    roomCode: this.roomCode,
                    targetUserId: 'admin'
                });
            }

            stopTalking() {
                if (!this.isTalking) return;
                
                console.log('Stop talking');
                this.isTalking = false;
                
                document.getElementById('talkBtn').classList.remove('talking');
                document.getElementById('talkBtn').textContent = 'Click to Talk';
                document.getElementById('userStatus').classList.remove('active');
                document.getElementById('volumeLevel').style.width = '0%';

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
                                sampleRate: 48000,
                                sampleSize: 16,
                                latency: 0
                            } 
                        });
                    }

                    if (!this.audioContext) {
                        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                            sampleRate: 48000,
                            latencyHint: 'playback'
                        });
                    }

                    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.localStream);
                    
                    // Add analyser for volume meter
                    this.analyser = this.audioContext.createAnalyser();
                    this.analyser.fftSize = 256;
                    this.mediaStreamSource.connect(this.analyser);
                    
                    this.scriptProcessor = this.audioContext.createScriptProcessor(1024, 1, 1);

                    this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                        if (this.isTalking && this.socket.connected) {
                            const inputBuffer = audioProcessingEvent.inputBuffer;
                            const inputData = inputBuffer.getChannelData(0);
                            
                            // Update volume meter
                            const rms = Math.sqrt(inputData.reduce((sum, val) => sum + val * val, 0) / inputData.length);
                            const volume = Math.min(100, Math.max(0, rms * 200));
                            document.getElementById('volumeLevel').style.width = volume + '%';
                            
                            // Convert to Int16Array for efficient transmission
                            const int16Data = new Int16Array(inputData.length);
                            for (let i = 0; i < inputData.length; i++) {
                                int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
                            }
                            
                            // Send audio data directly to admin
                            this.socket.volatile.emit('audio-data', {
                                roomCode: this.roomCode,
                                audioBuffer: int16Data.buffer,
                                sampleRate: this.audioContext.sampleRate,
                                targetUserId: 'admin'
                            });
                        }
                    };

                    this.mediaStreamSource.connect(this.scriptProcessor);
                    this.scriptProcessor.connect(this.audioContext.destination);
                    
                    console.log('High-quality audio streaming started');
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
                if (this.analyser) {
                    this.analyser.disconnect();
                    this.analyser = null;
                }
                console.log('Audio streaming stopped');
            }

            playAudio(audioBuffer) {
                try {
                    if (!this.audioContext) {
                        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                            sampleRate: 48000,
                            latencyHint: 'playback'
                        });
                    }

                    const int16Data = new Int16Array(audioBuffer);
                    const float32Data = new Float32Array(int16Data.length);
                    
                    // Convert back to Float32Array for playback
                    for (let i = 0; i < int16Data.length; i++) {
                        float32Data[i] = int16Data[i] / 32768;
                    }

                    const audioBufferSource = this.audioContext.createBuffer(1, float32Data.length, this.audioContext.sampleRate);
                    audioBufferSource.getChannelData(0).set(float32Data);

                    const source = this.audioContext.createBufferSource();
                    source.buffer = audioBufferSource;
                    source.connect(this.audioContext.destination);
                    source.start();
                    
                } catch (error) {
                    console.error('Error playing audio:', error);
                }
            }

            updateTalkingIndicator(userId, isTalking) {
                const adminStatus = document.getElementById('adminStatus');
                if (adminStatus) {
                    adminStatus.classList.toggle('active', isTalking);
                }
            }

            leaveRoom() {
                this.stopAudioStreaming();
                
                if (this.localStream) {
                    this.localStream.getTracks().forEach(track => track.stop());
                    this.localStream = null;
                }

                document.getElementById('joinSection').classList.remove('hidden');
                document.getElementById('chatSection').classList.add('hidden');
                document.getElementById('talkBtn').textContent = 'Click to Talk';
                document.getElementById('talkBtn').classList.remove('talking');
                
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
            max-width: 900px; 
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
        .broadcast-btn {
            background: #e74c3c;
            margin-left: 10px;
        }
        .broadcast-btn.active {
            background: #c0392b;
            box-shadow: 0 0 10px rgba(231, 76, 60, 0.5);
        }
        .users-container { 
            padding: 20px; 
            border-bottom: 1px solid #ecf0f1; 
        }
        .users-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); 
            gap: 16px; 
            margin-top: 12px; 
        }
        .user-circle { 
            background: #f8f9fa; 
            border: 2px solid #e9ecef; 
            border-radius: 12px; 
            padding: 16px; 
            text-align: center; 
            position: relative;
            transition: all 0.3s ease; 
            cursor: pointer;
        }
        .user-circle.connected:hover {
            border-color: #3498db;
            background: #e3f2fd;
        }
        .user-circle.disconnected {
            opacity: 0.5;
            cursor: not-allowed;
            background: #f8d7da;
            border-color: #f5c6cb;
        }
        .user-circle.talking { 
            border-color: #27ae60; 
            background: #d5f4e6; 
            animation: glow-green 1s infinite; 
        }
        .user-circle.receiving { 
            border-color: #e74c3c; 
            background: #fadbd8; 
            animation: glow-red 1s infinite; 
        }
        @keyframes glow-green { 
            0% { box-shadow: 0 0 10px #27ae60; } 
            50% { box-shadow: 0 0 20px #27ae60; } 
            100% { box-shadow: 0 0 10px #27ae60; } 
        }
        @keyframes glow-red { 
            0% { box-shadow: 0 0 10px #e74c3c; } 
            50% { box-shadow: 0 0 20px #e74c3c; } 
            100% { box-shadow: 0 0 10px #e74c3c; } 
        }
        .user-avatar { 
            font-size: 20px; 
            font-weight: bold; 
            color: #2c3e50;
            margin-bottom: 8px;
        }
        .user-name { 
            font-weight: 600; 
            font-size: 12px;
            color: #2c3e50;
            margin-bottom: 8px;
        }
        .user-status {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #27ae60;
            position: absolute;
            top: 8px;
            right: 8px;
            transition: all 0.3s ease;
        }
        .user-status.offline {
            background: #bdc3c7;
        }
        .user-controls {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-top: 8px;
        }
        .block-btn { 
            padding: 4px 8px; 
            font-size: 10px; 
            border-radius: 4px;
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
            .users-grid { grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); } 
        }
        h2 {
            font-size: 16px;
            color: #2c3e50;
            margin-bottom: 12px;
        }
        .connection-info {
            text-align: center;
            font-size: 12px;
            color: #666;
            margin-top: 8px;
        }
        .admin-controls {
            display: flex;
            gap: 10px;
            align-items: center;
            margin-top: 10px;
        }
        .volume-meter {
            width: 100%;
            height: 4px;
            background: #ecf0f1;
            border-radius: 2px;
            margin: 8px 0;
            overflow: hidden;
        }
        .volume-level {
            height: 100%;
            background: #27ae60;
            width: 0%;
            transition: width 0.1s ease;
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
                <div class="admin-controls">
                    <button id="createRoomBtn" disabled>Create New Room</button>
                    <button id="broadcastBtn" class="broadcast-btn" disabled>Broadcast to All</button>
                </div>
            </div>
        </div>

        <div class="users-container">
            <h2>Connected Users - Click to Talk to Individual User</h2>
            <div class="connection-info">Green glow = User talking • Red glow = You talking to user • Broadcast = Talk to all users</div>
            <div id="usersList" class="users-grid"></div>
        </div>

        <div class="volume-meter">
            <div class="volume-level" id="volumeLevel"></div>
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
                this.userName = 'Admin';
                this.isAdmin = true;
                this.isTalking = false;
                this.currentTalkingTo = null;
                this.isBroadcasting = false;
                this.localStream = null;
                this.audioContext = null;
                this.mediaStreamSource = null;
                this.scriptProcessor = null;
                this.analyser = null;
                this.reconnectAttempts = 0;
                this.blockedUsers = new Set();
                this.userConnections = new Map();
                this.init();
            }

            init() {
                this.connectToServer();
                this.initAdmin();
            }

            connectToServer() {
                console.log('Connecting to server...');
                this.updateConnectionStatus('connecting');
                
                if (this.socket) {
                    this.socket.disconnect();
                }

                this.socket = io({
                    reconnection: true,
                    reconnectionAttempts: 10,
                    reconnectionDelay: 1000,
                    timeout: 20000
                });
                
                this.socket.on('connect', () => {
                    console.log('Connected to server');
                    this.reconnectAttempts = 0;
                    this.updateConnectionStatus('connected');
                    document.getElementById('createRoomBtn').disabled = false;
                    document.getElementById('broadcastBtn').disabled = false;
                });

                this.socket.on('disconnect', (reason) => {
                    console.log('Disconnected from server:', reason);
                    this.updateConnectionStatus('disconnected');
                    document.getElementById('createRoomBtn').disabled = true;
                    document.getElementById('broadcastBtn').disabled = true;
                });

                this.socket.on('connect_error', (error) => {
                    console.log('Connection error:', error);
                    this.updateConnectionStatus('error');
                });

                this.socket.on('reconnect_attempt', (attempt) => {
                    console.log('Reconnection attempt:', attempt);
                    this.updateConnectionStatus('reconnecting');
                });

                this.socket.on('reconnect_failed', () => {
                    console.log('Reconnection failed');
                    this.showError('Connection lost. Please refresh the page.');
                });

                this.setupSocketListeners();
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
                document.getElementById('broadcastBtn').addEventListener('mousedown', () => this.startBroadcasting());
                document.getElementById('broadcastBtn').addEventListener('mouseup', () => this.stopTalking());
                document.getElementById('broadcastBtn').addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    this.startBroadcasting();
                });
                document.getElementById('broadcastBtn').addEventListener('touchend', (e) => {
                    e.preventDefault();
                    this.stopTalking();
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
                            sampleRate: 48000,
                            sampleSize: 16,
                            latency: 0
                        } 
                    });
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
                    this.showSuccess('Room created with code: ' + data.roomCode);
                });

                this.socket.on('user-joined', (data) => {
                    console.log('User joined:', data.userName);
                    this.userConnections.set(data.userId, true);
                    this.addUserToUI(data.userId, data.userName);
                    this.showSuccess('User ' + data.userName + ' joined the room');
                });

                this.socket.on('users-update', (users) => {
                    console.log('Users updated:', users.length + ' users');
                    this.updateUsersList(users);
                });

                this.socket.on('user-talking', (data) => {
                    console.log('User talking:', data.userId, 'isTalking:', data.isTalking);
                    this.updateTalkingIndicator(data.userId, data.isTalking);
                });

                this.socket.on('audio-data', (data) => {
                    this.playAudio(data.audioBuffer);
                });

                this.socket.on('user-left', (data) => {
                    console.log('User left:', data.userName);
                    this.userConnections.set(data.userId, false);
                    this.updateUserConnection(data.userId, false);
                    this.showMessage('User ' + data.userName + ' left the room');
                });

                this.socket.on('user-reconnected', (data) => {
                    console.log('User reconnected:', data.userName);
                    this.userConnections.set(data.userId, true);
                    this.updateUserConnection(data.userId, true);
                    this.showSuccess('User ' + data.userName + ' reconnected');
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

            startBroadcasting() {
                if (!this.roomCode || !this.socket.connected) {
                    this.showError('Not connected to room');
                    return;
                }
                
                console.log('Start broadcasting to all users');
                this.isTalking = true;
                this.isBroadcasting = true;
                this.currentTalkingTo = 'all';
                
                document.getElementById('broadcastBtn').classList.add('active');
                document.getElementById('broadcastBtn').textContent = 'Broadcasting...';

                this.startAudioStreaming('all');

                this.socket.emit('start-talking', {
                    roomCode: this.roomCode,
                    targetUserId: 'all'
                });
            }

            toggleTalking(targetUserId) {
                if (!this.roomCode || !this.socket.connected) {
                    this.showError('Not connected to room');
                    return;
                }
                
                if (!this.userConnections.get(targetUserId)) {
                    this.showError('User is not connected');
                    return;
                }
                
                if (this.isTalking && this.currentTalkingTo === targetUserId) {
                    this.stopTalking();
                } else {
                    if (this.isTalking) {
                        this.stopTalking();
                    }
                    this.startTalking(targetUserId);
                }
            }

            startTalking(targetUserId) {
                console.log('Start talking to:', targetUserId);
                this.isTalking = true;
                this.currentTalkingTo = targetUserId;

                const userCircle = document.getElementById('user-' + targetUserId);
                if (userCircle) {
                    userCircle.classList.add('receiving');
                }

                this.startAudioStreaming(targetUserId);

                this.socket.emit('start-talking', {
                    roomCode: this.roomCode,
                    targetUserId: targetUserId
                });
            }

            stopTalking() {
                console.log('Stop talking');
                this.isTalking = false;
                
                if (this.currentTalkingTo && this.currentTalkingTo !== 'all') {
                    const userCircle = document.getElementById('user-' + this.currentTalkingTo);
                    if (userCircle) {
                        userCircle.classList.remove('receiving');
                    }
                }
                
                if (this.isBroadcasting) {
                    document.getElementById('broadcastBtn').classList.remove('active');
                    document.getElementById('broadcastBtn').textContent = 'Broadcast to All';
                    this.isBroadcasting = false;
                }
                
                this.currentTalkingTo = null;
                document.getElementById('volumeLevel').style.width = '0%';

                this.stopAudioStreaming();

                this.socket.emit('stop-talking', {
                    roomCode: this.roomCode
                });
            }

            async startAudioStreaming(targetUserId) {
                try {
                    if (!this.localStream) {
                        this.localStream = await navigator.mediaDevices.getUserMedia({ 
                            audio: {
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true,
                                channelCount: 1,
                                sampleRate: 48000,
                                sampleSize: 16,
                                latency: 0
                            } 
                        });
                    }

                    if (!this.audioContext) {
                        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                            sampleRate: 48000,
                            latencyHint: 'playback'
                        });
                    }

                    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.localStream);
                    
                    // Add analyser for volume meter
                    this.analyser = this.audioContext.createAnalyser();
                    this.analyser.fftSize = 256;
                    this.mediaStreamSource.connect(this.analyser);
                    
                    this.scriptProcessor = this.audioContext.createScriptProcessor(1024, 1, 1);

                    this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                        if (this.isTalking && this.socket.connected) {
                            const inputBuffer = audioProcessingEvent.inputBuffer;
                            const inputData = inputBuffer.getChannelData(0);
                            
                            // Update volume meter
                            const rms = Math.sqrt(inputData.reduce((sum, val) => sum + val * val, 0) / inputData.length);
                            const volume = Math.min(100, Math.max(0, rms * 200));
                            document.getElementById('volumeLevel').style.width = volume + '%';
                            
                            // Convert to Int16Array for efficient transmission
                            const int16Data = new Int16Array(inputData.length);
                            for (let i = 0; i < inputData.length; i++) {
                                int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
                            }
                            
                            // Send audio data to specific user or all users
                            this.socket.volatile.emit('audio-data', {
                                roomCode: this.roomCode,
                                audioBuffer: int16Data.buffer,
                                sampleRate: this.audioContext.sampleRate,
                                targetUserId: targetUserId
                            });
                        }
                    };

                    this.mediaStreamSource.connect(this.scriptProcessor);
                    this.scriptProcessor.connect(this.audioContext.destination);
                    
                    console.log('High-quality audio streaming started to:', targetUserId);
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
                if (this.analyser) {
                    this.analyser.disconnect();
                    this.analyser = null;
                }
                console.log('Audio streaming stopped');
            }

            playAudio(audioBuffer) {
                try {
                    if (!this.audioContext) {
                        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                            sampleRate: 48000,
                            latencyHint: 'playback'
                        });
                    }

                    const int16Data = new Int16Array(audioBuffer);
                    const float32Data = new Float32Array(int16Data.length);
                    
                    for (let i = 0; i < int16Data.length; i++) {
                        float32Data[i] = int16Data[i] / 32768;
                    }

                    const audioBufferSource = this.audioContext.createBuffer(1, float32Data.length, this.audioContext.sampleRate);
                    audioBufferSource.getChannelData(0).set(float32Data);

                    const source = this.audioContext.createBufferSource();
                    source.buffer = audioBufferSource;
                    source.connect(this.audioContext.destination);
                    source.start();
                    
                } catch (error) {
                    console.error('Error playing audio:', error);
                }
            }

            addUserToUI(userId, userName) {
                const usersList = document.getElementById('usersList');

                const userCircle = document.createElement('div');
                userCircle.className = 'user-circle connected';
                userCircle.id = 'user-' + userId;
                userCircle.innerHTML = '<div class="user-avatar">' + userName.charAt(0).toUpperCase() + '</div>' +
                    '<div class="user-name">' + userName + '</div>' +
                    '<div class="user-status online"></div>' +
                    '<button class="block-btn" id="block-btn-' + userName + '">Block</button>';

                usersList.appendChild(userCircle);

                userCircle.addEventListener('click', (e) => {
                    if (!e.target.classList.contains('block-btn') && userCircle.classList.contains('connected')) {
                        this.toggleTalking(userId);
                    }
                });

                const blockBtn = document.getElementById('block-btn-' + userName);
                blockBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleBlockUser(userName);
                });
            }

            updateUserConnection(userId, isConnected) {
                const userElement = document.getElementById('user-' + userId);
                if (userElement) {
                    if (isConnected) {
                        userElement.classList.add('connected');
                        userElement.classList.remove('disconnected');
                        userElement.querySelector('.user-status').classList.add('online');
                        userElement.querySelector('.user-status').classList.remove('offline');
                    } else {
                        userElement.classList.add('disconnected');
                        userElement.classList.remove('connected');
                        userElement.querySelector('.user-status').classList.add('offline');
                        userElement.querySelector('.user-status').classList.remove('online');
                    }
                }
            }

            updateUsersList(users) {
                const usersList = document.getElementById('usersList');
                usersList.innerHTML = '';
                users.forEach(user => {
                    this.addUserToUI(user.id, user.name);
                });
            }

            updateTalkingIndicator(userId, isTalking) {
                const userCircle = document.getElementById('user-' + userId);
                if (userCircle) {
                    if (isTalking) {
                        userCircle.classList.add('talking');
                    } else {
                        userCircle.classList.remove('talking');
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

  // Rejoin room after reconnection
  socket.on('rejoin-room', (data) => {
    const { roomCode, userName } = data;
    console.log('Rejoin room attempt:', roomCode, 'by user:', userName);

    const room = rooms.get(roomCode);
    if (room) {
      const userEntry = Array.from(room.users.entries()).find(([id, user]) => user.name === userName);
      if (userEntry) {
        const [oldId, user] = userEntry;
        room.users.delete(oldId);
        user.id = socket.id;
        room.users.set(socket.id, user);
        
        socket.join(roomCode);
        console.log('User reconnected:', userName, 'to room:', roomCode);
        
        socket.to(room.admin).emit('user-reconnected', {
          userId: socket.id,
          userName: userName
        });
      }
    }
  });

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

  // Start talking
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

      // Notify admin when user talks
      if (socket.id !== room.admin) {
        socket.to(room.admin).emit('user-talking', {
          userId: socket.id,
          isTalking: true
        });
      }
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

        // Notify admin when user stops talking
        if (socket.id !== room.admin) {
          socket.to(room.admin).emit('user-talking', {
            userId: socket.id,
            isTalking: false
          });
        }
      }
    }
  });

  // Real-time audio data streaming
  socket.on('audio-data', (data) => {
    const { roomCode, audioBuffer, sampleRate, targetUserId } = data;
    
    const room = rooms.get(roomCode);
    if (room) {
      if (targetUserId === 'admin') {
        // User talking to admin - send only to admin
        socket.to(room.admin).volatile.emit('audio-data', {
          audioBuffer: audioBuffer,
          sampleRate: sampleRate,
          targetUserId: socket.id
        });
      } else if (targetUserId === 'all') {
        // Admin broadcasting to all users
        socket.to(roomCode).volatile.emit('audio-data', {
          audioBuffer: audioBuffer,
          sampleRate: sampleRate,
          targetUserId: 'all'
        });
      } else {
        // Admin talking to specific user
        socket.to(targetUserId).volatile.emit('audio-data', {
          audioBuffer: audioBuffer,
          sampleRate: sampleRate,
          targetUserId: socket.id
        });
      }
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
          socket.emit('users-update', Array.from(room.users.values()));
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
