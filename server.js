const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e7 // Increased buffer size to 10MB for safety (Base64 audio)
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

// --- Serve Static Files (CSS, Socket.io, JSZip) ---

// Serve the large client script file
app.get('/client.js', (req, res) => {
    // In a real project, this would read from a file on disk. 
    // Here, we fetch the client script string directly.
    res.setHeader('Content-Type', 'application/javascript');
    res.send(getClientScriptContent());
});

// Serve the user and admin pages (HTML templates)
app.get('/', (req, res) => res.send(getUserPageContent()));
app.get('/admin', (req, res) => res.send(getAdminPageContent()));

// --- HTML Template Functions (To keep the main routes clean) ---

function getCommonStyles() {
    // JSZip is loaded here via CDN for the ZIP download functionality
    return `
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; min-height: 100vh; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden; }
            .header { background: #2c3e50; color: white; padding: 20px; text-align: center; }
            .connection-status { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 8px; font-size: 13px; }
            .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #95a5a6; }
            .status-dot.connected { background: #27ae60; }
            .status-dot.reconnecting { background: #f39c12; animation: pulse 1s infinite; }
            @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
            .join-section, .chat-section, .log-section { padding: 24px; }
            .input-group { display: flex; flex-direction: column; gap: 12px; margin: 16px 0; }
            input { padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; background: #fafafa; }
            input:focus { outline: none; border-color: #3498db; background: white; }
            button { background: #3498db; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; transition: all 0.2s ease; }
            button:hover { background: #2980b9; }
            button:disabled { background: #bdc3c7; cursor: not-allowed; }
            .talk-btn { background: #27ae60; font-size: 16px; font-weight: 600; padding: 16px; width: 140px; height: 140px; border-radius: 50%; margin: 20px auto; display: flex; align-items: center; justify-content: center; box-shadow: 0 5px 15px rgba(39, 174, 96, 0.4); transition: transform 0.1s, background 0.2s, box-shadow 0.2s; }
            .talk-btn:active { transform: scale(0.95); box-shadow: 0 2px 5px rgba(39, 174, 96, 0.6); }
            .talk-btn.talking { background: #e74c3c; box-shadow: 0 5px 15px rgba(231, 76, 60, 0.4); }
            .talk-btn.talking:active { box-shadow: 0 2px 5px rgba(231, 76, 60, 0.6); }
            .talk-btn:disabled { background: #bdc3c7; box-shadow: none; }
            .hidden { display: none !important; }
            .error-message, .success-message { padding: 12px; border-radius: 6px; margin: 12px 0; text-align: center; font-size: 13px; color: white; }
            .error-message { background: #e74c3c; }
            .success-message { background: #27ae60; }
            .status-indicators { display: flex; justify-content: center; gap: 24px; margin: 16px 0; }
            .status-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #666; }
            .status-dot-sm { width: 12px; height: 12px; border-radius: 50%; background: #bdc3c7; }
            .status-dot-sm.active { background: #27ae60; }
            .admin-status.active { background: #f39c12; }
            .user-info { text-align: center; margin-bottom: 16px; padding: 12px; background: #f8f9fa; border-radius: 6px; font-size: 13px; color: #555; }
            .mic-indicator { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 12px 0; font-size: 13px; color: #666; }
            .mic-dot { width: 10px; height: 10px; border-radius: 50%; background: #e74c3c; }
            .mic-dot.active { background: #27ae60; }

            /* Admin Styles */
            .admin-container { max-width: 800px; }
            .users-container { padding: 20px; border-top: 1px solid #ecf0f1; }
            .users-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 20px; margin-top: 12px; }
            .user-circle { background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 12px; padding: 12px; position: relative; transition: all 0.3s ease; display: flex; flex-direction: column; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
            .user-circle.admin-target { border-color: #3498db; box-shadow: 0 0 15px rgba(52, 152, 219, 0.7); }
            .user-circle.talking { border-color: #27ae60; background: #d5f4e6; box-shadow: 0 0 10px rgba(39, 174, 96, 0.5); }
            .user-circle.receiving { border-color: #e74c3c; background: #fadbd8; animation: glow-red 1s infinite; box-shadow: 0 0 15px rgba(231, 76, 60, 0.7); }
            .user-avatar { font-size: 24px; font-weight: bold; color: #2c3e50; width: 50px; height: 50px; border-radius: 50%; background: #ecf0f1; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
            
            /* Log Console Styles */
            .log-section h2 { font-size: 18px; font-weight: 600; color: #2c3e50; margin-bottom: 12px; border-bottom: 2px solid #ddd; padding-bottom: 6px; }
            .log-console { max-height: 250px; overflow-y: auto; background: #f9f9f9; border-radius: 8px; padding: 10px; border: 1px solid #eee; }
            .log-item { display: flex; flex-direction: column; }
            .log-header { display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 5px; }
            .log-controls { display: flex; align-items: center; gap: 8px; }

            /* Custom Audio Player Styles */
            .audio-player { 
                display: flex; 
                align-items: center; 
                gap: 8px; 
                background: rgba(255,255,255,0.2); 
                padding: 4px; 
                border-radius: 9999px;
                width: 100%;
                margin-top: 5px;
            }
            .audio-player-btn { 
                width: 28px; 
                height: 28px; 
                border-radius: 50%; 
                display: flex; 
                align-items: center; 
                justify-content: center;
                background: #3498db;
                color: white;
                padding: 0;
                flex-shrink: 0;
            }
            .audio-player-btn svg { width: 14px; height: 14px; }
            .audio-time { font-size: 10px; flex-shrink: 0; width: 40px; text-align: center; }
            .audio-seek { flex-grow: 1; height: 4px; padding: 0; margin: 0; background: #fff; appearance: none; cursor: pointer; }
            .audio-seek::-webkit-slider-thumb { appearance: none; width: 10px; height: 10px; background: #3498db; border-radius: 50%; }
        </style>
    `;
}

function getUserPageContent() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>User - Walkie Talkie</title>
    ${getCommonStyles()}
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="font-size: 20px; margin-bottom: 8px;">User Walkie Talkie</h1>
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
                <button id="joinRoomBtn">Join Room</button>
            </div>
        </div>
        
        <div class="chat-section hidden" id="chatSection">
            <div class="user-info">
                <div>Connected as: <strong id="currentUserName"></strong></div>
                <div>Room: <strong id="currentRoomCode"></strong></div>
            </div>
            
            <div class="mic-indicator">
                <div class="mic-dot" id="micIndicator"></div>
                <span>Microphone Status</span>
            </div>
            
            <button id="talkBtn" class="talk-btn">HOLD TO TALK</button>
            
            <div class="status-indicators">
                <div class="status-item">
                    <div class="status-dot-sm" id="userStatus"></div>
                    <span>You Talking</span>
                </div>
                <div class="status-item">
                    <div class="status-dot-sm admin-status" id="adminStatus"></div>
                    <span>Receiving Admin</span>
                </div>
            </div>
        </div>
        
        <div class="log-section" id="logSection">
            <h2>Transmission Log (TO / FROM Admin)</h2>
            <div class="log-console" id="transmissionConsole">
                <p class="text-center text-gray-500 italic text-sm py-4">Waiting to connect to room...</p>
            </div>
        </div>

        <div class="error-message hidden" id="errorMessage"></div>
        <div class="success-message hidden" id="successMessage"></div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script src="/client.js"></script>
    <script>
        window.onload = () => {
             const app = new WalkieTalkieApp(false);
        };
    </script>
</body>
</html>
    `;
}

function getAdminPageContent() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - Walkie Talkie</title>
    ${getCommonStyles()}
    <style> .container { max-width: 800px; } </style>
</head>
<body>
    <div class="container admin-container">
        <div class="header">
            <h1 style="font-size: 20px; margin-bottom: 8px;">Walkie Talkie Admin Console</h1>
            <div class="connection-status">
                <div class="status-dot" id="connectionStatus"></div>
                <span id="connectionText">Connecting...</span>
            </div>
            <div class="room-info">
                <div>Room Code: <span id="roomCode">----</span></div>
                <button id="createRoomBtn">Create New Room</button>
            </div>
        </div>

        <div class="users-container">
            <h2>Connected Users (Click 'Talk' to initiate conversation)</h2>
            <div class="mic-indicator">
                <div class="mic-dot" id="micIndicator"></div>
                <span>Admin Microphone Status</span>
            </div>
            <div id="usersList" class="users-grid">
                <!-- Users will be populated here -->
            </div>
        </div>
        
        <div class="log-section">
            <div class="flex justify-between items-center mb-3">
                <h2>Transmission Log (FROM / TO Users)</h2>
                <button id="downloadAllLogsBtn" class="bg-purple-600 hover:bg-purple-700 p-2 text-sm">Download All Logs (ZIP)</button>
            </div>
            <div class="log-console" id="transmissionConsole">
                <p class="text-center text-gray-500 italic text-sm py-4">Connect to a room to view transmission history...</p>
            </div>
        </div>

        <div class="error-message hidden" id="errorMessage"></div>
        <div class="success-message hidden" id="successMessage"></div>
    </div>
    
    <script src="/socket.io/socket.io.js"></script>
    <script src="/client.js"></script>
    <script>
        window.onload = () => {
             const app = new WalkieTalkieApp(true);
        };
    </script>
</body>
</html>
    `;
}

// --- Socket.io Connection Handling ---
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Admin creates room
  socket.on('create-room', (data) => {
    const { userName } = data || { userName: 'Admin' };
    const roomCode = generateRoomCode();
    
    // Clean up if admin was already in a room
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

    if (!room) {
      socket.emit('error', { message: 'Room not found. Please check the room code.' });
      return;
    }

    if (socket.id === room.admin) { // Admin rejoining
        socket.join(roomCode);
        socket.emit('room-created', { roomCode, userName: room.adminName });
        const users = Array.from(room.users.values());
        socket.emit('users-update', users);
        return;
    }

    if (room.blockedUsers.has(userName)) {
      socket.emit('blocked', { message: 'You are blocked from this room' });
      return;
    }
    
    // Check if user name is already taken by an active user
    const existingUser = Array.from(room.users.values()).find(user => user.name === userName);
    if (existingUser) {
      socket.emit('error', { message: 'User name already exists in this room. Please choose a different name.' });
      return;
    }

    room.users.set(socket.id, {
      id: socket.id,
      name: userName,
      isTalking: false
    });

    socket.join(roomCode);
    socket.emit('room-joined', { roomCode, userName, adminId: room.admin });
    
    const users = Array.from(room.users.values());
    io.to(room.admin).emit('users-update', users);
  });

  // Handle client-side log transmission
  socket.on('log-transmission', (logEntry) => {
      if (!transmissionLogs.has(logEntry.roomCode)) {
          transmissionLogs.set(logEntry.roomCode, []);
      }
      transmissionLogs.get(logEntry.roomCode).push(logEntry);
      
      // Notify all users in the room to update their consoles
      io.to(logEntry.roomCode).emit('logs-update', {
          roomCode: logEntry.roomCode,
          logs: transmissionLogs.get(logEntry.roomCode)
      });
  });
  
  // Handle log request from client (on join/reconnect)
  socket.on('fetch-logs', (data) => {
      const logs = transmissionLogs.get(data.roomCode) || [];
      socket.emit('logs-update', {
          roomCode: data.roomCode,
          logs: logs
      });
  });
  

  // Start talking (Audio stream starts on client, server only signals)
  socket.on('start-talking', (data) => {
    const { targetUserId, roomCode } = data;

    const room = rooms.get(roomCode);
    if (!room) return;
    
    const isSenderAdmin = socket.id === room.admin;
    const speaker = isSenderAdmin ? { id: socket.id, name: room.adminName } : room.users.get(socket.id);
    
    if (!speaker) return;
    
    let receiverId = targetUserId;
    if (!isSenderAdmin) {
        if (targetUserId !== room.admin) return;
        receiverId = room.admin;
    }
    
    io.to(roomCode).emit('user-talking', {
      userId: socket.id,
      targetUserId: receiverId,
      isTalking: true
    });
  });

  // Stop talking
  socket.on('stop-talking', (data) => {
    const { roomCode } = data;

    const room = rooms.get(roomCode);
    if (!room) return;
    
    io.to(roomCode).emit('user-talking', {
      userId: socket.id,
      isTalking: false
    });
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
    if (!isSenderAdmin) {
        receiverId = room.admin;
    }
    
    if (room.blockedUsers.has(sender.name)) return;
    
    // Broadcast to the intended receiver AND the original sender (for echo/self-playback confirmation)
    const socketsToReceive = new Set([receiverId, senderId]);

    socketsToReceive.forEach(id => {
        io.to(id).emit('audio-data', {
            audioBuffer: audioBuffer,
            sampleRate: sampleRate,
            senderId: senderId,
            targetUserId: receiverId 
        });
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
  console.log('User Page: http://localhost:' + PORT + '/');
  console.log('Admin Page: http://localhost:' + PORT + '/admin');
});


// --- The Large Client Script Content (Served via /client.js route) ---
function getClientScriptContent() {
    // This entire block contains the client-side JavaScript for the WalkieTalkieApp, AudioPlayer, 
    // persistence, and download logic.
    return `
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
        
        // Load the audio source immediately
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
        this.logs = []; // Local copy of transmission logs

        this.init();
    }

    init() {
        if (!this.isAdmin) {
            this.loadFromLocalStorage();
        } else {
            // Admin default name for persistence
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

        this.socket = io({ reconnection: false });
        
        this.socket.on('connect', () => {
            this.reconnectAttempts = 0;
            this.updateConnectionStatus('connected');
            this.enableButtons();
            
            // --- Auto-Reconnect/Rejoin Logic ---
            if (this.roomCode && this.userName) {
                if (this.isAdmin) {
                    // Admin rejoining uses a special signal to reclaim the room
                    this.socket.emit('create-room', { userName: this.userName }); 
                } else {
                    // User rejoins
                    this.socket.emit('join-room', { 
                        roomCode: this.roomCode, 
                        userName: this.userName 
                    });
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
            
            const talkBtn = document.getElementById('talkBtn');
            if (talkBtn) {
                // Use non-passive events for mobile PTT
                talkBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.startTalking(this.currentTalkingTo) }, { passive: false });
                talkBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.stopTalking() }, { passive: false });
                talkBtn.addEventListener('mousedown', () => this.startTalking(this.currentTalkingTo));
                document.addEventListener('mouseup', () => this.stopTalking()); // Use document for robust release
            }
        }
    }

    async testMicrophoneAccess() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 } 
            });
            const micIndicator = document.getElementById('micIndicator');
            if(micIndicator) micIndicator.classList.add('active');
            
            // Stop tracks immediately after testing access to free the mic
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
        
        this.socket.on('user-left', (data) => {
            this.removeUserFromUI(data.userId);
        });

        this.socket.on('blocked', (data) => {
            this.showError(data.message);
            this.leaveRoom();
        });

        this.socket.on('room-closed', () => {
            this.showError('Room has been closed by admin');
            this.leaveRoom();
        });

        this.socket.on('error', (data) => {
            this.showError(data.message);
        });
        
        this.socket.on('user-blocked', (data) => {
            if (this.isAdmin) {
                this.blockedUsers.add(data.userName);
                this.updateBlockButton(data.userName, true);
            }
        });

        this.socket.on('user-unblocked', (data) => {
            if (this.isAdmin) {
                this.blockedUsers.delete(data.userName);
                this.updateBlockButton(data.userName, false);
            }
        });
    }

    createRoom() {
        if (!this.socket.connected) {
            this.showError('Not connected to server');
            return;
        }
        this.socket.emit('create-room', { userName: this.userName });
    }

    joinRoom() {
        const userNameInput = document.getElementById('userName');
        const roomCodeInput = document.getElementById('roomCode');
        const userName = userNameInput.value.trim();
        const roomCode = roomCodeInput.value.trim();

        if (!userName) {
            this.showError('Please enter your name');
            return;
        }
        if (!roomCode || roomCode.length !== 4 || !/^\\d{4}$/.test(roomCode)) {
            this.showError('Please enter a valid 4-digit room code');
            return;
        }

        this.userName = userName;
        this.socket.emit('join-room', { roomCode, userName });
    }

    // PTT Logic
    async startTalking(targetUserId) {
        if (!this.roomCode || !this.socket.connected) {
            this.showError('Not connected to room');
            return;
        }
        if (this.isTalking) return; 
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 } 
            });
        } catch (e) {
            this.showError('Microphone access denied. Cannot start talk session.');
            return;
        }

        const finalTargetId = this.isAdmin ? targetUserId : this.currentTalkingTo;
        if (!finalTargetId) {
             this.showError('No target selected or no admin in room.');
             return;
        }

        this.isTalking = true;
        this.currentTalkingTo = finalTargetId;
        
        if (!this.isAdmin) {
            const talkBtn = document.getElementById('talkBtn');
            if (talkBtn) {
               talkBtn.classList.add('talking');
               talkBtn.textContent = 'RELEASE TO SEND';
            }
            const userStatus = document.getElementById('userStatus');
            if (userStatus) userStatus.classList.add('active');
        } else {
            this.updateAdminTalkButtons(finalTargetId);
        }
        
        await this.startAudioStreaming();
        this.startRecordingCapture(); 

        this.socket.emit('start-talking', {
            targetUserId: finalTargetId,
            roomCode: this.roomCode,
        });
    }

    stopTalking() {
        if (!this.isTalking) return;
        
        this.isTalking = false;
        
        if (!this.isAdmin) {
            const talkBtn = document.getElementById('talkBtn');
            if (talkBtn) {
                talkBtn.classList.remove('talking');
                talkBtn.textContent = 'HOLD TO TALK';
            }
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

        this.socket.emit('stop-talking', {
            roomCode: this.roomCode,
        });
    }

    // --- RECORDING CAPTURE LOGIC (Client-side) ---
    startRecordingCapture() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return;
        
        this.audioChunks = [];
        this.mediaRecorder = new MediaRecorder(this.localStream, { mimeType: 'audio/webm' });
        
        this.mediaRecorder.ondataavailable = (event) => {
            this.audioChunks.push(event.data);
        };

        this.mediaRecorder.onstop = () => {
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
            this.logTransmission(audioBlob); 
        };

        this.mediaRecorder.start();
    }

    stopRecordingCapture() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                resolve(reader.result.split(',')[1]);
            };
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
            const user = Array.from(this.users || []).find(u => u.id === userId);
            return user ? user.name : 'Unknown User';
        } else {
            // User view, target is always Admin
            return 'Admin'; 
        }
    }
    
    // --- ZIP and Single Download Logic ---

    base64ToBlob(base64, mimeType) {
        const sliceSize = 512;
        const byteCharacters = atob(base64);
        const byteArrays = [];

        for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            const slice = byteCharacters.slice(offset, offset + sliceSize);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            byteArrays.push(new Uint8Array(byteNumbers));
        }
        return new Blob(byteArrays, { type: mimeType });
    }

    downloadSingleLog(base64, mimeType, filename) {
        const blob = this.base64ToBlob(base64, mimeType);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showSuccess('Single log downloaded.');
    }

    async downloadAllLogsAsZip() {
        if (!window.JSZip) {
            this.showError('JSZip library not loaded. Cannot download ZIP.');
            return;
        }

        const zip = new JSZip();
        
        this.showSuccess('Preparing to download ' + this.logs.length + ' files...');

        this.logs.forEach((log, index) => {
            const blob = this.base64ToBlob(log.audioBase64, log.mimeType);
            const date = new Date(log.timestamp);
            const filename = \`\${date.toISOString().replace(/[:.]/g, '-')}_\${log.senderName}_to_\${log.receiverName}.webm\`;
            zip.file(filename, blob);
        });

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


    // --- AUDIO STREAMING (Sender) ---
    async startAudioStreaming() {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.localStream);
            this.scriptProcessor = this.audioContext.createScriptProcessor(1024, 1, 1);

            this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                if (this.isTalking && this.socket.connected) {
                    const inputBuffer = audioProcessingEvent.inputBuffer;
                    const inputData = inputBuffer.getChannelData(0);
                    
                    const int16Data = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
                    }
                    
                    this.socket.emit('audio-data', {
                        roomCode: this.roomCode,
                        audioBuffer: int16Data.buffer,
                        sampleRate: this.audioContext.sampleRate,
                        targetUserId: this.currentTalkingTo,
                        senderId: this.socket.id 
                    });
                }
            };

            this.mediaStreamSource.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);
            
        } catch (error) {
            this.showError('Could not start microphone stream. Check permissions and try again.');
            this.stopTalking();
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
    }
    
    // --- AUDIO PLAYBACK (Receiver/Sender Echo) ---
    async playAudio(audioBuffer, sampleRate) {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume().catch(err => console.error("Failed to resume audio context:", err));
            }

            const int16Data = new Int16Array(audioBuffer);
            const float32Data = new Float32Array(int16Data.length);
            
            for (let i = 0; i < int16Data.length; i++) {
                float32Data[i] = int16Data[i] / 32768;
            }

            const incomingAudioBuffer = this.audioContext.createBuffer(1, float32Data.length, sampleRate);
            incomingAudioBuffer.getChannelData(0).set(float32Data);

            const source = this.audioContext.createBufferSource();
            source.buffer = incomingAudioBuffer;
            source.connect(this.audioContext.destination);
            source.start(0); 
            
        } catch (error) {
            console.error('Error playing audio:', error);
        }
    }
    
    // --- CONSOLE RENDERING LOGIC ---
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
                            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm1 11H9v-4h2v4zm-1-6a1 1 0 110-2 1 1 0 010 2z"/>
                            </svg>
                        </button>
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
            
            // Initialize the custom AudioPlayer class for this log item
            new AudioPlayer(item, log.audioBase64, log.mimeType);

            // Bind single download button
            item.querySelector('.download-log-btn').addEventListener('click', (e) => {
                const btn = e.currentTarget;
                this.downloadSingleLog(
                    btn.getAttribute('data-base64'),
                    btn.getAttribute('data-mimetype'),
                    btn.getAttribute('data-filename')
                );
            });
        });
        consoleEl.scrollTop = consoleEl.scrollHeight; 
        
        // Illustrate the new UI 
    }
    // --- END CONSOLE RENDERING LOGIC ---

    addUserToUI(userId, userName) {
        if (!this.isAdmin) return;

        const usersList = document.getElementById('usersList');
        if (document.getElementById('user-' + userId)) return; 

        const userCircle = document.createElement('div');
        userCircle.className = 'user-circle';
        userCircle.id = 'user-' + userId;
        
        const isBlocked = this.blockedUsers.has(userName);

        userCircle.innerHTML = \`
            <div class="user-avatar">\${userName.charAt(0).toUpperCase()}</div>
            <div class="user-name" style="font-size: 13px;">\${userName}</div>
            <div class="user-controls">
                <button class="talk-btn-mini \${isBlocked ? 'blocked' : ''}" data-user-id="\${userId}" data-user-name="\${userName}">
                    \${isBlocked ? 'Blocked' : 'Talk'}
                </button>
                <button class="block-btn" id="block-btn-\${userName}" data-user-name="\${userName}" style="font-size: 10px; padding: 4px 8px; margin-top: 5px;">
                    \${isBlocked ? 'Unblock' : 'Block'}
                </button>
            </div>
        \`;

        usersList.appendChild(userCircle);
        
        const talkBtnMini = userCircle.querySelector('.talk-btn-mini');
        talkBtnMini.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleAdminTalking(userId);
        });
        
        const blockBtn = document.getElementById('block-btn-' + userName);
        blockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleBlockUser(userName);
        });
    }

    removeUserFromUI(userId) {
        const userElement = document.getElementById('user-' + userId);
        if (userElement) {
            userElement.remove();
        }
        if (this.isAdmin && this.currentTalkingTo === userId) {
            this.stopTalking();
        }
    }

    updateUsersList(users) {
        if (!this.isAdmin) return;
        
        const usersList = document.getElementById('usersList');
        usersList.innerHTML = '';
        this.users = users; 
        
        users.forEach(user => {
            this.addUserToUI(user.id, user.name);
        });
        this.updateAdminTalkButtons(this.currentTalkingTo);
    }
    
    // Remaining methods (toggleAdminTalking, updateAdminTalkButtons, etc.) follow the previous logic.
    // ... [The rest of the client-side logic is included here for completeness]

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

    toggleBlockUser(userName) {
        if (this.isAdmin && this.roomCode) {
            this.socket.emit('toggle-block-user', {
                roomCode: this.roomCode,
                userName: userName
            });
        }
    }

    updateBlockButton(userName, isBlocked) {
        const blockBtn = document.getElementById('block-btn-' + userName);
        const talkBtnMini = document.querySelector(\`.talk-btn-mini[data-user-name="\${userName}"]\`);

        if (blockBtn) {
            blockBtn.textContent = isBlocked ? 'Unblock' : 'Block';
            blockBtn.classList.toggle('blocked', !isBlocked); 
        }
        if (talkBtnMini) {
            talkBtnMini.textContent = isBlocked ? 'Blocked' : 'Talk';
            talkBtnMini.classList.toggle('blocked', isBlocked);
            talkBtnMini.disabled = isBlocked;
            
            if (isBlocked && this.currentTalkingTo === talkBtnMini.getAttribute('data-user-id')) {
                this.stopTalking();
            }
            this.updateAdminTalkButtons(this.currentTalkingTo); 
        }
    }
    
    leaveRoom() {
        this.stopAudioStreaming();
        this.stopRecordingCapture();
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Clear UI and localStorage
        localStorage.removeItem('walkieRoomCode');
        localStorage.removeItem('walkieUserName');
        this.roomCode = null;
        this.userName = this.isAdmin ? 'Admin' : null;

        if (this.isAdmin) {
            document.getElementById('roomCode').textContent = '----';
            const usersList = document.getElementById('usersList');
            if (usersList) usersList.innerHTML = '';
        } else {
            const joinSection = document.getElementById('joinSection');
            if (joinSection) joinSection.classList.remove('hidden');
            const chatSection = document.getElementById('chatSection');
            if (chatSection) chatSection.classList.add('hidden');
        }
        
        const consoleEl = document.getElementById('transmissionConsole');
        if (consoleEl) consoleEl.innerHTML = '<p class="text-center text-gray-500 italic text-sm py-4">Waiting to connect to room...</p>';
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
    `;
}

