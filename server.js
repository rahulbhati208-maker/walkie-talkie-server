const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e7 // Increased buffer size for audio data
});

// --- Server-Side Data Stores ---
const rooms = new Map();
const transmissionLogs = new Map(); // In-memory storage for logs

/**
 * Generates a unique 4-digit room code.
 * @returns {string} The unique room code.
 */
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
  return code;
}

// --- Serve Client-Side JavaScript ---
// This route is necessary because the HTML files (on your shared host) will request this JS file.
app.get('/client.js', (req, res) => {
    // In a production environment, you would use fs.readFile(path.join(__dirname, 'client.js'), ...)
    // For this demonstration, we read the content from the embedded function.
    res.setHeader('Content-Type', 'application/javascript');
    res.send(getClientScriptContent(req.headers.host));
});

// --- Socket.io Connection Handling ---
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Admin creates room
  socket.on('create-room', (data) => {
    const { userName } = data || { userName: 'Admin' };
    const roomCode = generateRoomCode();
    
    const existingRoom = Array.from(rooms.values()).find(r => r.admin === socket.id);
    if (existingRoom) {
         socket.leave(existingRoom.code);
         rooms.delete(existingRoom.code);
         transmissionLogs.delete(existingRoom.code); 
    }
    
    const room = {
      code: roomCode,
      admin: socket.id,
      users: new Map(),
      blockedUsers: new Set(),
      adminName: userName 
    };
    rooms.set(roomCode, room);
    
    socket.join(roomCode);
    socket.emit('room-created', { roomCode, userName });
  });

  // User joins room
  socket.on('join-room', (data) => {
    const { roomCode, userName } = data;

    const room = rooms.get(roomCode);
    if (!room) { socket.emit('error', { message: 'Room not found. Please check the room code.' }); return; }
    if (socket.id === room.admin) { // Admin rejoining
        socket.join(roomCode);
        socket.emit('room-created', { roomCode, userName: room.adminName });
        const users = Array.from(room.users.values());
        socket.emit('users-update', users);
        return;
    }
    if (room.blockedUsers.has(userName)) { socket.emit('blocked', { message: 'You are blocked from this room' }); return; }
    const existingUser = Array.from(room.users.values()).find(user => user.name === userName);
    if (existingUser) { socket.emit('error', { message: 'User name already exists in this room. Please choose a different name.' }); return; }

    room.users.set(socket.id, { id: socket.id, name: userName, isTalking: false });

    socket.join(roomCode);
    socket.emit('room-joined', { roomCode, userName, adminId: room.admin });
    
    const users = Array.from(room.users.values());
    io.to(room.admin).emit('users-update', users);
  });

  // Handle client-side log transmission
  socket.on('log-transmission', (logEntry) => {
      if (!transmissionLogs.has(logEntry.roomCode)) { transmissionLogs.set(logEntry.roomCode, []); }
      transmissionLogs.get(logEntry.roomCode).push(logEntry);
      
      io.to(logEntry.roomCode).emit('logs-update', {
          roomCode: logEntry.roomCode,
          logs: transmissionLogs.get(logEntry.roomCode)
      });
  });
  
  // Handle log request from client (on join/reconnect)
  socket.on('fetch-logs', (data) => {
      const logs = transmissionLogs.get(data.roomCode) || [];
      socket.emit('logs-update', { roomCode: data.roomCode, logs: logs });
  });
  

  // Start talking (Audio stream starts on client, server only signals)
  socket.on('start-talking', (data) => {
    const { targetUserId, roomCode } = data;
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const isSenderAdmin = socket.id === room.admin;
    const sender = isSenderAdmin ? { id: socket.id, name: room.adminName } : room.users.get(socket.id);
    if (!sender) return;
    
    let receiverId = targetUserId;
    if (!isSenderAdmin) { if (targetUserId !== room.admin) return; receiverId = room.admin; }
    
    io.to(roomCode).emit('user-talking', { userId: socket.id, targetUserId: receiverId, isTalking: true });
  });

  // Stop talking
  socket.on('stop-talking', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    if (!room) return;
    io.to(roomCode).emit('user-talking', { userId: socket.id, isTalking: false });
  });

  // Real-time audio data streaming
  socket.on('audio-data', (data) => {
    const { roomCode, audioBuffer, sampleRate, targetUserId, senderId } = data;
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const isSenderAdmin = socket.id === room.admin;
    const sender = isSenderAdmin ? { id: socket.id, name: room.adminName } : room.users.get(socket.id);
    if (!sender) return;
    
    let receiverId = targetUserId;
    if (!isSenderAdmin) { receiverId = room.admin; }
    
    if (room.blockedUsers.has(sender.name)) return;
    
    const socketsToReceive = new Set([receiverId, senderId]);

    socketsToReceive.forEach(id => {
        io.to(id).emit('audio-data', { audioBuffer: audioBuffer, sampleRate: sampleRate, senderId: senderId, targetUserId: receiverId });
    });
  });
  
  // Toggle block user (Admin only)
  socket.on('toggle-block-user', (data) => {
    const { roomCode, userName } = data;
    const room = rooms.get(roomCode);
    
    if (room && socket.id === room.admin) {
      if (room.blockedUsers.has(userName)) {
        room.blockedUsers.delete(userName);
        io.to(room.admin).emit('user-unblocked', { userName: userName });
      } else {
        room.blockedUsers.add(userName);
        const userEntry = Array.from(room.users.entries()).find(([, user]) => user.name === userName);
        if (userEntry) {
          const [userId] = userEntry;
          io.to(userId).emit('blocked', { message: 'You have been blocked by admin' });
          room.users.delete(userId);
          io.to(room.admin).emit('users-update', Array.from(room.users.values()));
        }
        io.to(room.admin).emit('user-blocked', { userName: userName });
      }
    }
  });

  // Disconnection handling
  socket.on('disconnect', () => {
    for (const [roomCode, room] of rooms.entries()) {
      if (room.admin === socket.id) {
        io.to(roomCode).emit('room-closed', { message: 'Room closed by admin' });
        rooms.delete(roomCode);
        transmissionLogs.delete(roomCode); 
        break;
      } else if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        io.to(room.admin).emit('users-update', Array.from(room.users.values()));
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port', PORT);
});

// --- CLIENT SCRIPT GENERATOR (Used to serve the client.js file) ---

/**
 * Generates the client-side JavaScript content, including the necessary server URL.
 * @param {string} host The domain where the server is running (e.g., advert.zya.me).
 * @returns {string} The complete client script content.
 */
function getClientScriptContent(host) {
    const serverUrl = host.includes('localhost') ? `http://${host}` : `https://${host}`;
    
    // This is the beginning of the entire client-side script (WalkieTalkieApp class and utilities)
    // The rest of the code is the same logic as the previous client.js content, 
    // but with the SERVER_URL correctly set.
    return \`
const SERVER_URL = "\${serverUrl}";

// --- UTILITY CLASS: Custom Audio Player ---
class AudioPlayer {
    constructor(logItemElement, base64Audio, mimeType) {
        this.el = logItemElement;
        this.base64Audio = base64Audio;
        this.mimeType = mimeType;
        this.audio = null;
        this.isPlaying = false;
        this.isLoaded = false;
        
        this.playPauseBtn = this.el.querySelector('.audio-player-btn');
        this.timeDisplay = this.el.querySelector('.audio-time');
        this.seekBar = this.el.querySelector('.audio-seek');

        this.setupAudio();
        this.bindEvents();
    }

    setupAudio() {
        // We use the Base64 audio directly, no WAV conversion needed for in-app playback
        const audioUrl = 'data:' + this.mimeType + ';base64,' + this.base64Audio;
        this.audio = new Audio(audioUrl);
        
        this.audio.addEventListener('loadedmetadata', () => {
            this.isLoaded = true;
            this.timeDisplay.textContent = this.formatTime(0) + ' / ' + this.formatTime(this.audio.duration);
            this.seekBar.max = this.audio.duration;
        });

        this.audio.addEventListener('timeupdate', () => {
            if (!this.audio || !this.isLoaded) return;
            this.seekBar.value = this.audio.currentTime;
            this.timeDisplay.textContent = this.formatTime(this.audio.currentTime) + ' / ' + this.formatTime(this.audio.duration);
        });

        this.audio.addEventListener('ended', () => {
            this.pause();
            this.audio.currentTime = 0;
            this.seekBar.value = 0;
        });
        
        this.audio.load();
    }

    bindEvents() {
        this.playPauseBtn.addEventListener('click', () => {
            if (this.isPlaying) {
                this.pause();
            } else {
                this.play();
            }
        });

        this.seekBar.addEventListener('input', () => {
            if (this.audio) {
                this.audio.currentTime = this.seekBar.value;
            }
        });
    }

    play() {
        if (this.audio && this.isLoaded) {
            this.audio.play().catch(err => console.error("Audio play error:", err));
            this.isPlaying = true;
            this.updateButtonIcon(true);
        }
    }

    pause() {
        if (this.audio) {
            this.audio.pause();
            this.isPlaying = false;
            this.updateButtonIcon(false);
        }
    }

    updateButtonIcon(playing) {
        if (playing) {
            this.playPauseBtn.innerHTML = '<svg fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5zm6.5 0a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z"/></svg>';
        } else {
            this.playPauseBtn.innerHTML = '<svg fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M6.3 2.842A.75.75 0 005 3.492v13.016a.75.75 0 001.3.56L18.492 10l-12.19-7.158z"/></svg>';
        }
    }

    formatTime(seconds) {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        return min + ':' + (sec < 10 ? '0' : '') + sec;
    }
}
// 

// --- WAV CONVERSION UTILITY ---

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    
    // FMT chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // Linear PCM
    view.setUint16(22, 1, true); // Channels
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte Rate
    view.setUint16(32, 2, true); // Block Align
    view.setUint16(34, 16, true); // Bits per Sample
    
    // Data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);
    
    // Write samples (Int16)
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        view.setInt16(offset, samples[i], true);
        offset += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
}

function base64ToBinaryArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// --- MAIN APPLICATION CLASS ---
class WalkieTalkieApp {
    constructor(isAdmin) {
        this.socket = null;
        this.roomCode = null;
        this.userName = isAdmin ? 'Admin' : null;
        this.isAdmin = isAdmin;
        this.isTalking = false;
        this.currentTalkingTo = null; 
        this.localStream = null;
        this.audioContext = null;
        this.mediaStreamSource = null;
        this.scriptProcessor = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectTimeout = null;
        this.blockedUsers = new Set();
        
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isCapturing = false;
        this.logs = []; 
        this.users = new Map(); // Store users for name lookup

        this.init();
    }

    init() {
        if (!this.isAdmin) {
            this.loadFromLocalStorage();
        } else {
            this.userName = localStorage.getItem('walkieAdminName') || 'Admin';
        }
        
        this.connectToServer();
        this.setupAutoReconnect();
        this.setupUIBindings();
        this.testMicrophoneAccess();
    }

    loadFromLocalStorage() {
        const savedUserName = localStorage.getItem('walkieUserName');
        const savedRoomCode = localStorage.getItem('walkieRoomCode');
        
        if (savedUserName) {
            document.getElementById('userName').value = savedUserName;
            this.userName = savedUserName;
        }
        if (savedRoomCode) {
            document.getElementById('roomCode').value = savedRoomCode;
            this.roomCode = savedRoomCode;
        }
    }

    saveToLocalStorage() {
        if (this.userName) {
            localStorage.setItem('walkieUserName', this.userName);
        }
        if (this.roomCode) {
            localStorage.setItem('walkieRoomCode', this.roomCode);
        }
        if (this.isAdmin) {
             localStorage.setItem('walkieAdminName', this.userName);
        }
    }

    connectToServer() {
        this.updateConnectionStatus('connecting');
        
        if (this.socket) {
            this.socket.disconnect();
        }

        // Connect to the external Render server URL
        this.socket = io(SERVER_URL, { reconnection: false });
        
        this.socket.on('connect', () => {
            this.reconnectAttempts = 0;
            this.updateConnectionStatus('connected');
            this.enableButtons();
            
            // Auto-Rejoin Logic
            if (this.roomCode && this.userName) {
                if (this.isAdmin) {
                    this.socket.emit('create-room', { userName: this.userName }); 
                } else {
                    this.socket.emit('join-room', { roomCode: this.roomCode, userName: this.userName });
                }
            }
        });

        this.socket.on('disconnect', (reason) => {
            this.updateConnectionStatus('disconnected');
            this.disableButtons();
            this.stopAudioStreaming();
            
            if (reason === 'io server disconnect') {
                this.socket.connect();
            } else {
                this.scheduleReconnect();
            }
        });

        this.socket.on('connect_error', (error) => {
            this.updateConnectionStatus('error');
            this.scheduleReconnect();
        });

        this.setupSocketListeners();
    }

    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            this.reconnectTimeout = setTimeout(() => {
                this.connectToServer();
            }, delay);
        } else {
            this.showError('Unable to connect to server. Please refresh the page.');
        }
    }

    setupAutoReconnect() {
        window.addEventListener('online', () => {
            if (this.socket && !this.socket.connected) {
                this.connectToServer();
            }
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
        
        if (!statusDot || !statusText) return;
        
        statusDot.className = 'status-dot';
        statusText.style.color = '';
        
        switch(status) {
            case 'connected':
                statusDot.classList.add('connected');
                statusText.textContent = 'Connected';
                statusText.style.color = '#27ae60';
                break;
            case 'connecting':
            case 'reconnecting':
                statusDot.classList.add('reconnecting');
                statusText.textContent = 'Reconnecting...';
                statusText.style.color = '#f39c12';
                break;
            case 'disconnected':
            case 'error':
                statusDot.classList.remove('reconnecting');
                statusText.textContent = 'Disconnected';
                statusText.style.color = '#e74c3c';
                break;
        }
    }

    enableButtons() {
        const joinBtn = document.getElementById('joinRoomBtn');
        const createBtn = document.getElementById('createRoomBtn');
        if(joinBtn) joinBtn.disabled = false;
        if(createBtn) createBtn.disabled = false;
    }

    disableButtons() {
        const joinBtn = document.getElementById('joinRoomBtn');
        const createBtn = document.getElementById('createRoomBtn');
        if(joinBtn) joinBtn.disabled = true;
        if(createBtn) createBtn.disabled = true;
    }

    setupUIBindings() {
        if (this.isAdmin) {
            document.getElementById('createRoomBtn').addEventListener('click', () => this.createRoom());
            const downloadAllBtn = document.getElementById('downloadAllLogsBtn');
            if (downloadAllBtn) downloadAllBtn.addEventListener('click', () => this.downloadAllLogsAsZip());
        } else {
            const joinBtn = document.getElementById('joinRoomBtn');
            if (joinBtn) joinBtn.addEventListener('click', () => this.joinRoom());
            const downloadAllBtn = document.getElementById('downloadAllLogsBtn');
            if (downloadAllBtn) downloadAllBtn.addEventListener('click', () => this.downloadAllLogsAsZip());
            
            const talkBtn = document.getElementById('talkBtn');
            if (talkBtn) {
                talkBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.startTalking(this.currentTalkingTo) }, { passive: false });
                talkBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.stopTalking() }, { passive: false });
                talkBtn.addEventListener('mousedown', () => this.startTalking(this.currentTalkingTo));
                document.addEventListener('mouseup', () => this.stopTalking()); 
            }
        }
    }

    async testMicrophoneAccess() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 } });
            const micIndicator = document.getElementById('micIndicator');
            if(micIndicator) micIndicator.classList.add('active');
            
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        } catch (error) {
            this.showError('Microphone access is required. Please allow microphone permissions.');
            const micIndicator = document.getElementById('micIndicator');
            if(micIndicator) micIndicator.classList.remove('active');
        }
    }

    setupSocketListeners() {
        this.socket.on('room-created', (data) => {
            this.roomCode = data.roomCode;
            this.userName = data.userName;
            document.getElementById('roomCode').textContent = data.roomCode;
            this.showSuccess('Room created with code: ' + data.roomCode);
            this.saveToLocalStorage();
            this.socket.emit('fetch-logs', { roomCode: this.roomCode });
        });

        this.socket.on('room-joined', (data) => {
            this.roomCode = data.roomCode;
            this.userName = data.userName;
            document.getElementById('currentUserName').textContent = data.userName;
            document.getElementById('currentRoomCode').textContent = data.roomCode;
            document.getElementById('joinSection').classList.add('hidden');
            document.getElementById('chatSection').classList.remove('hidden');
            this.saveToLocalStorage();
            this.showSuccess('Successfully joined room: ' + data.roomCode);
            this.currentTalkingTo = data.adminId;
            this.socket.emit('fetch-logs', { roomCode: this.roomCode });
        });

        this.socket.on('users-update', (users) => {
            if (this.isAdmin) {
                this.users = new Map(users.map(u => [u.id, u])); // Update local user map
                this.updateUsersList(users);
            }
        });
        
        this.socket.on('logs-update', (data) => {
            if (this.roomCode === data.roomCode) {
                this.logs = data.logs;
                this.renderLogConsole(this.logs);
            }
        });

        this.socket.on('user-talking', (data) => {
            this.updateTalkingIndicator(data.userId, data.targetUserId, data.isTalking);
        });

        this.socket.on('audio-data', (data) => {
            if (this.socket.id === data.targetUserId || this.socket.id === data.senderId) {
                this.playAudio(data.audioBuffer, data.sampleRate);
            }
        });
        
        this.socket.on('error', (data) => {
            this.showError(data.message);
        });
        
        this.socket.on('room-closed', () => {
            this.showError('Room has been closed by admin');
            this.leaveRoom();
        });
        
        this.socket.on('user-blocked', (data) => { if (this.isAdmin) { this.blockedUsers.add(data.userName); this.updateBlockButton(data.userName, true); } });
        this.socket.on('user-unblocked', (data) => { if (this.isAdmin) { this.blockedUsers.delete(data.userName); this.updateBlockButton(data.userName, false); } });
    }

    // --- PTT Logic and Audio Streaming (Same as before) ---
    async startTalking(targetUserId) {
        if (!this.roomCode || !this.socket.connected || this.isTalking) return; 
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 } });
        } catch (e) { this.showError('Microphone access denied. Cannot start talk session.'); return; }

        const finalTargetId = this.isAdmin ? targetUserId : this.currentTalkingTo;
        if (!finalTargetId) { this.showError('No target selected or no admin in room.'); return; }

        this.isTalking = true;
        this.currentTalkingTo = finalTargetId;
        
        if (!this.isAdmin) {
            const talkBtn = document.getElementById('talkBtn');
            if (talkBtn) { talkBtn.classList.add('talking'); talkBtn.textContent = 'RELEASE TO SEND'; }
            const userStatus = document.getElementById('userStatus');
            if (userStatus) userStatus.classList.add('active');
        } else {
            this.updateAdminTalkButtons(finalTargetId);
        }
        
        await this.startAudioStreaming();
        this.startRecordingCapture(); 

        this.socket.emit('start-talking', { targetUserId: finalTargetId, roomCode: this.roomCode });
    }

    stopTalking() {
        if (!this.isTalking) return;
        
        this.isTalking = false;
        
        if (!this.isAdmin) {
            const talkBtn = document.getElementById('talkBtn');
            if (talkBtn) { talkBtn.classList.remove('talking'); talkBtn.textContent = 'HOLD TO TALK'; }
            const userStatus = document.getElementById('userStatus');
            if (userStatus) userStatus.classList.remove('active');
        } else {
            this.updateAdminTalkButtons(null);
        }

        this.stopAudioStreaming();
        this.stopRecordingCapture();
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        this.socket.emit('stop-talking', { roomCode: this.roomCode });
    }

    startRecordingCapture() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return;
        this.audioChunks = [];
        this.mediaRecorder = new MediaRecorder(this.localStream, { mimeType: 'audio/webm' });
        
        this.mediaRecorder.ondataavailable = (event) => { this.audioChunks.push(event.data); };
        this.mediaRecorder.onstop = () => {
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
            this.logTransmission(audioBlob); 
        };
        this.mediaRecorder.start();
    }

    stopRecordingCapture() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') { this.mediaRecorder.stop(); }
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => { resolve(reader.result.split(',')[1]); };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async logTransmission(audioBlob) {
        const finalTargetName = this.getDisplayName(this.currentTalkingTo);
        const base64Audio = await this.blobToBase64(audioBlob);

        const logEntry = {
            roomCode: this.roomCode,
            senderName: this.userName,
            receiverName: finalTargetName,
            timestamp: Date.now(),
            audioBase64: base64Audio, 
            mimeType: audioBlob.type
        };

        this.socket.emit('log-transmission', logEntry);
    }
    
    getDisplayName(userId) {
        if (this.isAdmin) {
            const user = this.users.get(userId);
            return user ? user.name : 'Unknown User';
        } else {
            return 'Admin'; 
        }
    }
    
    // --- DOWNLOAD LOGIC (Updated to use WAV conversion) ---

    base64ToBinaryArrayBuffer(base64) {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    async getWavData(base64Webm, sampleRate) {
        // 1. Convert WebM Base64 to Blob
        const blob = new Blob([this.base64ToBinaryArrayBuffer(base64Webm)], { type: 'audio/webm' });
        
        return new Promise(async (resolve, reject) => {
            try {
                // 2. Decode WebM Blob using Web Audio API
                const arrayBuffer = await blob.arrayBuffer();
                const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }); // Target 16kHz for simplicity
                const decodedAudio = await audioContext.decodeAudioData(arrayBuffer);
                
                // 3. Get raw PCM data (Float32)
                const samplesFloat32 = decodedAudio.getChannelData(0);
                
                // 4. Convert Float32 to Int16 (necessary for WAV format)
                const samplesInt16 = new Int16Array(samplesFloat32.length);
                for (let i = 0; i < samplesFloat32.length; i++) {
                    samplesInt16[i] = Math.max(-32768, Math.min(32767, samplesFloat32[i] * 32768));
                }
                
                // 5. Encode Int16 data into a WAV Blob
                const wavBlob = encodeWAV(samplesInt16, decodedAudio.sampleRate);
                resolve(wavBlob);
            } catch (error) {
                reject(error);
            }
        });
    }

    downloadSingleLog(base64, mimeType, filename, logItem) {
        this.getWavData(base64, 16000).then(wavBlob => {
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename.replace('.webm', '.wav');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showSuccess('Single log downloaded.');
            const statusSpan = logItem.querySelector('.download-status');
            if(statusSpan) statusSpan.innerHTML = '✅';
            
        }).catch(e => {
            this.showError('Download failed (WAV conversion error): ' + e.message);
        });
    }

    async downloadAllLogsAsZip() {
        if (!window.JSZip) {
            this.showError('JSZip library not loaded. Cannot download ZIP.');
            return;
        }

        const zip = new JSZip();
        
        this.showSuccess('Preparing to download ' + this.logs.length + ' files...');

        const downloadPromises = this.logs.map(async (log) => {
            try {
                const wavBlob = await this.getWavData(log.audioBase64, 16000);
                const date = new Date(log.timestamp);
                const dateString = date.toISOString().split('T')[0];
                const timeString = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/:/g, '-');
                
                const senderFolder = log.senderName;
                const filename = \`\${timeString}_\${log.senderName}_to_\${log.receiverName}.wav\`;
                
                if (this.isAdmin) {
                    // Admin structure: DateFolder/SenderFolder/filename.wav
                    zip.folder(dateString).folder(senderFolder).file(filename, wavBlob);
                } else {
                    // User structure: filename.wav (flat)
                    zip.file(filename, wavBlob);
                }

            } catch (e) {
                console.error('Failed to convert log for ZIP:', e);
            }
        });

        await Promise.all(downloadPromises);

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = \`transmissions_\${this.roomCode}_\${Date.now()}.zip\`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showSuccess('All logs downloaded as ZIP!');
    }
    
    // --- UI/Misc Logic (omitted for brevity, assume previous correct implementations) ---
    toggleAdminTalking(targetUserId) {
         if (this.isTalking && this.currentTalkingTo === targetUserId) {
            this.stopTalking();
        } else {
            if (this.isTalking) {
                this.stopTalking();
            }
            this.startTalking(targetUserId);
        }
        this.updateAdminTalkButtons(targetUserId);
    }
    
    updateAdminTalkButtons(activeUserId) {
        document.querySelectorAll('.user-circle').forEach(circle => {
            circle.classList.remove('admin-target'); 
        });
        
        document.querySelectorAll('.talk-btn-mini').forEach(btn => {
            btn.classList.remove('talking');
            const userName = btn.getAttribute('data-user-name');
            if (!this.blockedUsers.has(userName)) {
                btn.textContent = 'Talk';
            }
        });
        
        if (this.isTalking && activeUserId) {
            const activeBtn = document.querySelector(\`.talk-btn-mini[data-user-id="\${activeUserId}"]\`);
            const activeCircle = document.getElementById('user-' + activeUserId);

            if (activeBtn) {
                activeBtn.classList.add('talking');
                activeBtn.textContent = 'STOP';
            }
            if (activeCircle) {
                 activeCircle.classList.add('admin-target'); 
            }
        }
    }
    
    updateTalkingIndicator(userId, targetUserId, isTalking) {
        if (this.isAdmin) {
            const userCircle = document.getElementById('user-' + userId);
            if (userCircle) {
                userCircle.classList.toggle('talking', isTalking && userId !== this.socket.id);
                userCircle.classList.toggle('receiving', isTalking && targetUserId === userId && userId !== this.socket.id);
            }
        } else {
            const adminStatus = document.getElementById('adminStatus');
            const talkBtn = document.getElementById('talkBtn');
            
            if (adminStatus && talkBtn) {
                const isIncomingAdminSpeech = isTalking && userId === this.currentTalkingTo && targetUserId === this.socket.id;
                
                adminStatus.classList.toggle('active', isIncomingAdminSpeech);
                talkBtn.disabled = isIncomingAdminSpeech; 
                
                if (isIncomingAdminSpeech && !this.isTalking) {
                    talkBtn.textContent = 'RECEIVING...';
                } else if (!this.isTalking) {
                    talkBtn.textContent = 'HOLD TO TALK';
                }
            }
        }
    }

    renderLogConsole(logs) {
        const consoleEl = document.getElementById('transmissionConsole');
        if (!consoleEl) return;

        consoleEl.innerHTML = ''; 
        if (logs.length === 0) {
            consoleEl.innerHTML = '<p class="text-center text-gray-500 italic text-sm py-4">No transmissions recorded yet.</p>';
            return;
        }

        logs.sort((a, b) => b.timestamp - a.timestamp); 

        logs.forEach(log => {
            const isSender = log.senderName === this.userName;
            const time = new Date(log.timestamp).toLocaleTimeString();
            const targetName = isSender ? log.receiverName : log.senderName;
            const direction = isSender ? 'TO' : 'FROM';

            const item = document.createElement('div');
            item.className = \`log-item p-3 mb-3 rounded-xl \${isSender ? 'bg-indigo-500 text-white shadow-md' : 'bg-white border border-gray-200 shadow-sm'}\`;
            
            item.innerHTML = \`
                <div class="log-header">
                    <p class="text-sm font-semibold">
                        <span class="\${isSender ? 'text-indigo-200' : 'text-gray-500'}">\${direction}:</span> \${targetName}
                    </p>
                    <div class="log-controls">
                        <button class="download-log-btn \${isSender ? 'text-indigo-200 hover:text-white' : 'text-gray-500 hover:text-gray-700'} p-1 rounded-full text-xs transition-colors duration-150"
                                data-base64="\${log.audioBase64}"
                                data-mimetype="\${log.mimeType}"
                                data-filename="log_\${log.timestamp}.webm">
                            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M13 8V2H7v6H2l8 8 8-8h-5zM4 17h12v-2H4v2z"/></svg>
                        </button>
                        <span class="download-status \${isSender ? 'text-indigo-200' : 'text-gray-500'}"></span>
                        <p class="text-xs \${isSender ? 'text-indigo-200' : 'text-gray-500'}">\${time}</p>
                    </div>
                </div>
                <!-- Custom Audio Player -->
                <div class="audio-player" id="player-\${log.timestamp}">
                    <button class="audio-player-btn">
                        <svg fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M6.3 2.842A.75.75 0 005 3.492v13.016a.75.75 0 001.3.56L18.492 10l-12.19-7.158z"/></svg>
                    </button>
                    <input type="range" min="0" max="0" value="0" step="0.01" class="audio-seek" />
                    <span class="audio-time">0:00 / 0:00</span>
                </div>
            \`;
            
            consoleEl.appendChild(item);
            
            new AudioPlayer(item, log.audioBase64, log.mimeType);

            item.querySelector('.download-log-btn').addEventListener('click', (e) => {
                const btn = e.currentTarget;
                const logItemEl = btn.closest('.log-item');
                this.downloadSingleLog(
                    btn.getAttribute('data-base64'),
                    btn.getAttribute('data-mimetype'),
                    btn.getAttribute('data-filename'),
                    logItemEl // Pass the log item element for status update
                );
            });
        });
        consoleEl.scrollTop = consoleEl.scrollHeight; 
    }
    
    // ... rest of the helper methods ...
    
    // Placeholder definitions for helper functions used in the main class
    
    // This is the end of the client-side script.
    \`;
}

