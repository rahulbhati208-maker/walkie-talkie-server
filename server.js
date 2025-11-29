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
  },
  maxHttpBufferSize: 1e6 
});

// Store rooms and users globally
const rooms = new Map();

// In-memory storage for transmission logs (replaces external DB for recordings)
// Structure: Map<roomCode, Array<LogEntry>>
const transmissionLogs = new Map();

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

// --- CLIENT-SIDE JAVASCRIPT LOGIC (Served separately at /client.js) ---

function getClientScriptContent() {
    return `
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

                    this.init();
                }

                init() {
                    if (!this.isAdmin) {
                        this.loadFromLocalStorage();
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

                    this.socket = io({ reconnection: false });
                    
                    this.socket.on('connect', () => {
                        console.log('Connected to server, Socket ID:', this.socket.id);
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
                        this.stopAudioStreaming();
                        
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
                            statusDot.textContent = 'Connecting...';
                            statusDot.style.color = '#3498db';
                            break;
                        case 'reconnecting':
                            statusDot.classList.add('reconnecting');
                            statusText.textContent = 'Reconnecting...';
                            statusText.style.color = '#f39c12';
                            break;
                        case 'disconnected':
                            statusDot.textContent = 'Disconnected';
                            statusDot.style.color = '#e74c3c';
                            break;
                        case 'error':
                            statusDot.textContent = 'Connection Error';
                            statusDot.style.color = '#e74c3c';
                            break;
                    }
                }

                enableButtons() {
                    if (!this.isAdmin) {
                        const joinBtn = document.getElementById('joinRoomBtn');
                        if(joinBtn) joinBtn.disabled = false;
                    } else {
                         const createBtn = document.getElementById('createRoomBtn');
                         if(createBtn) createBtn.disabled = false;
                    }
                }

                disableButtons() {
                    if (!this.isAdmin) {
                        const joinBtn = document.getElementById('joinRoomBtn');
                        if(joinBtn) joinBtn.disabled = true;
                    } else {
                        const createBtn = document.getElementById('createRoomBtn');
                        if(createBtn) createBtn.disabled = true;
                    }
                }

                setupUIBindings() {
                    if (this.isAdmin) {
                        document.getElementById('createRoomBtn').addEventListener('click', () => this.createRoom());
                    } else {
                        document.getElementById('joinRoomBtn').addEventListener('click', () => this.joinRoom());
                        
                        const talkBtn = document.getElementById('talkBtn');
                        if (talkBtn) {
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
                            audio: {
                                echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000
                            } 
                        });
                        
                        const micIndicator = document.getElementById('micIndicator');
                        if(micIndicator) micIndicator.classList.add('active');
                        
                        this.localStream.getTracks().forEach(track => track.stop());
                        this.localStream = null;
                        
                    } catch (error) {
                        console.error('Microphone access denied:', error);
                        this.showError('Microphone access is required. Please allow microphone permissions.');
                        const micIndicator = document.getElementById('micIndicator');
                        if(micIndicator) micIndicator.classList.remove('active');
                    }
                }

                setupSocketListeners() {
                    this.socket.on('room-created', (data) => {
                        this.roomCode = data.roomCode;
                        document.getElementById('roomCode').textContent = data.roomCode;
                        this.showSuccess('Room created with code: ' + data.roomCode);
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
                            this.renderLogConsole(data.logs);
                        }
                    });

                    this.socket.on('user-talking', (data) => {
                        this.updateTalkingIndicator(data.userId, data.targetUserId, data.isTalking);
                    });

                    this.socket.on('audio-data', (data) => {
                        // CRITICAL FIX: The receiver must always play, regardless of their PTT state.
                        if (this.socket.id === data.targetUserId) {
                             this.playAudio(data.audioBuffer, data.sampleRate);
                        }
                         // The sender receiving their echo. Playback for confirmation.
                        else if (this.socket.id === data.senderId) {
                            this.playAudio(data.audioBuffer, data.sampleRate);
                        }
                    });
                    
                    this.socket.on('user-left', (data) => {
                        this.removeUserFromUI(data.userId);
                        this.showMessage('User ' + data.userName + ' left the room');
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
                            this.showSuccess('User ' + data.userName + ' has been blocked');
                        }
                    });

                    this.socket.on('user-unblocked', (data) => {
                        if (this.isAdmin) {
                            this.blockedUsers.delete(data.userName);
                            this.updateBlockButton(data.userName, false);
                            this.showSuccess('User ' + data.userName + ' has been unblocked');
                        }
                    });
                }

                createRoom() {
                    if (!this.socket.connected) {
                        this.showError('Not connected to server');
                        return;
                    }
                    this.socket.emit('create-room');
                }

                joinRoom() {
                    const userNameInput = document.getElementById('userName');
                    const roomCodeInput = document.getElementById('roomCode');
                    const userName = userNameInput.value.trim();
                    const roomCode = roomCodeInput.value.trim();

                    if (!userName) {
                        this.showError('Please enter your name');
                        userNameInput.focus();
                        return;
                    }

                    if (!roomCode || roomCode.length !== 4 || !/^\\d{4}$/.test(roomCode)) {
                        this.showError('Please enter a valid 4-digit room code');
                        roomCodeInput.focus();
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
                    if (this.isTalking) return; // Prevent double trigger
                    
                    try {
                        if (!this.localStream) {
                            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 } 
                            });
                        }
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
                    
                    // START AUDIO CAPTURE AND LIVE STREAM
                    await this.startAudioStreaming();
                    this.startRecordingCapture(); // Start client-side recording for logging

                    this.socket.emit('start-talking', {
                        targetUserId: finalTargetId,
                        roomCode: this.roomCode,
                        startTime: Date.now()
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

                    // STOP AUDIO CAPTURE AND LIVE STREAM
                    this.stopAudioStreaming();
                    this.stopRecordingCapture(); // Stop client-side recording and log transmission

                    this.socket.emit('stop-talking', {
                        roomCode: this.roomCode,
                        stopTime: Date.now()
                    });
                }

                // --- RECORDING CAPTURE LOGIC (Client-side) ---
                startRecordingCapture() {
                    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return;
                    
                    this.audioChunks = [];
                    // Use the microphone stream directly for recording
                    this.mediaRecorder = new MediaRecorder(this.localStream, { mimeType: 'audio/webm' });
                    
                    this.mediaRecorder.ondataavailable = (event) => {
                        this.audioChunks.push(event.data);
                    };

                    this.mediaRecorder.onstop = () => {
                        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                        this.logTransmission(audioBlob); // Process and send to server log
                    };

                    this.mediaRecorder.start();
                    this.isCapturing = true;
                }

                stopRecordingCapture() {
                    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                        this.mediaRecorder.stop();
                        this.isCapturing = false;
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
                        return user ? user.name : 'Admin';
                    } else if (userId === this.currentTalkingTo) {
                        return 'Admin'; 
                    } else {
                        return 'Unknown';
                    }
                }
                // --- END RECORDING CAPTURE LOGIC ---


                // --- AUDIO STREAMING (Sender) ---
                async startAudioStreaming() {
                    try {
                        if (!this.audioContext) {
                            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                        }
                        // CRITICAL FIX: Ensure audio context is not suspended by browser
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
                                    senderId: this.socket.id // Include sender ID for self-playback logic on server side
                                });
                            }
                        };

                        this.mediaStreamSource.connect(this.scriptProcessor);
                        this.scriptProcessor.connect(this.audioContext.destination);
                        
                    } catch (error) {
                        console.error('Error starting audio streaming:', error);
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
                playAudio(audioBuffer, sampleRate) {
                    try {
                        if (!this.audioContext) {
                            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                        }
                        // CRITICAL FIX: Ensure audio context is resumed before creating buffer source
                        if (this.audioContext.state === 'suspended') {
                            this.audioContext.resume().catch(err => console.error("Failed to resume audio context:", err));
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

                    consoleEl.innerHTML = ''; // Clear existing logs

                    if (logs.length === 0) {
                        consoleEl.innerHTML = '<p class="text-center text-gray-500 italic text-sm py-4">No transmissions recorded yet.</p>';
                        return;
                    }

                    logs.sort((a, b) => b.timestamp - a.timestamp); // Newest first

                    logs.forEach(log => {
                        const isSender = log.senderName === this.userName;
                        const time = new Date(log.timestamp).toLocaleTimeString();
                        const targetName = isSender ? log.receiverName : log.senderName;
                        const direction = isSender ? 'TO' : 'FROM';

                        const item = document.createElement('div');
                        item.className = \`log-item p-3 mb-2 rounded-lg \${isSender ? 'bg-indigo-500 text-white shadow-md' : 'bg-white border border-gray-200'}\`;
                        
                        item.innerHTML = \`
                            <div class="flex justify-between items-center">
                                <p class="text-sm font-semibold">
                                    \${direction}: \${targetName}
                                </p>
                                <button class="play-log-btn \${isSender ? 'bg-indigo-400 hover:bg-indigo-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-800' } p-1 rounded-full text-xs transition-colors duration-150"
                                        data-base64="\${log.audioBase64}"
                                        data-mimetype="\${log.mimeType}">
                                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path>
                                    </svg>
                                </button>
                            </div>
                            <p class="text-xs \${isSender ? 'text-indigo-200' : 'text-gray-500'} mt-1">\${time}</p>
                        \`;
                        
                        consoleEl.appendChild(item);

                        item.querySelector('.play-log-btn').addEventListener('click', (e) => {
                            const btn = e.currentTarget;
                            const base64 = btn.getAttribute('data-base64');
                            const mimeType = btn.getAttribute('data-mimetype');
                            const audioUrl = \`data:\${mimeType};base64,\${base64}\`;
                            new Audio(audioUrl).play().catch(err => console.error("Playback error:", err));
                        });
                    });
                    consoleEl.scrollTop = consoleEl.scrollHeight; 
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
                        <div class="user-name">\${userName}</div>
                        <div class="user-status online"></div>
                        <div class="user-controls">
                            <button class="talk-btn-mini \${isBlocked ? 'blocked' : ''}" data-user-id="\${userId}" data-user-name="\${userName}">
                                \${isBlocked ? 'Blocked' : 'Talk'}
                            </button>
                            <button class="block-btn" id="block-btn-\${userName}" data-user-name="\${userName}">
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
                            
                            if (isIncomingAdminSpeech) {
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

                    if (this.isAdmin) {
                        document.getElementById('roomCode').textContent = '----';
                        const usersList = document.getElementById('usersList');
                        if (usersList) usersList.innerHTML = '';
                    } else {
                        const joinSection = document.getElementById('joinSection');
                        if (joinSection) joinSection.classList.remove('hidden');
                        const chatSection = document.getElementById('chatSection');
                        if (chatSection) chatSection.classList.add('hidden');
                        
                        const talkBtn = document.getElementById('talkBtn');
                        if (talkBtn) talkBtn.textContent = 'HOLD TO TALK';
                        
                        const userStatus = document.getElementById('userStatus');
                        if (userStatus) userStatus.classList.remove('active');
                        const adminStatus = document.getElementById('adminStatus');
                        if (adminStatus) adminStatus.classList.remove('active');
                    }
                    this.roomCode = null;
                    this.userName = null;
                    localStorage.removeItem('walkieRoomCode');
                    localStorage.removeItem('walkieUserName');
                    
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


// --- Express Routes ---

// Route 1: Serve the main client script file separately
app.get('/client.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(getClientScriptContent());
});

// Route 2: Serve the CSS styles
function getCommonStyles() {
    return `
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
                box-shadow: 0 4px 20px rgba(0,0,0,0.1); 
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
            .join-section, .chat-section, .log-section { padding: 24px; }
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
                width: 140px; 
                height: 140px; 
                border-radius: 50%; 
                margin: 20px auto; 
                display: flex; 
                align-items: center;
                justify-content: center;
                box-shadow: 0 5px 15px rgba(39, 174, 96, 0.4);
                transition: transform 0.1s, background 0.2s, box-shadow 0.2s;
            }
            .talk-btn:active {
                transform: scale(0.95);
                box-shadow: 0 2px 5px rgba(39, 174, 96, 0.6);
            }
            .talk-btn.talking { 
                background: #e74c3c;
                box-shadow: 0 5px 15px rgba(231, 76, 60, 0.4);
            }
            .talk-btn.talking:active {
                box-shadow: 0 2px 5px rgba(231, 76, 60, 0.6);
            }
            .talk-btn:disabled { background: #bdc3c7; box-shadow: none; }
            .hidden { display: none !important; }
            .error-message, .success-message { 
                padding: 12px; 
                border-radius: 6px; 
                margin: 12px 0; 
                text-align: center; 
                font-size: 13px;
                color: white;
            }
            .error-message { background: #e74c3c; }
            .success-message { background: #27ae60; }
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
            .status-dot-sm { 
                width: 12px; 
                height: 12px; 
                border-radius: 50%; 
                background: #bdc3c7; 
            }
            .status-dot-sm.active { background: #27ae60; }
            .admin-status.active { background: #f39c12; }
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

            /* Admin Styles */
            .users-container { padding: 20px; border-top: 1px solid #ecf0f1; }
            .users-grid { 
                display: grid; 
                grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); 
                gap: 20px; 
                margin-top: 12px; 
            }
            .user-circle { 
                background: #f8f9fa; 
                border: 2px solid #e9ecef; 
                border-radius: 12px; 
                padding: 12px; 
                text-align: center; 
                position: relative;
                transition: all 0.3s ease; 
                display: flex;
                flex-direction: column;
                align-items: center;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }
            .user-circle.admin-target {
                border-color: #3498db; 
                box-shadow: 0 0 15px rgba(52, 152, 219, 0.7);
            }
            .user-circle.talking { 
                border-color: #27ae60; 
                background: #d5f4e6; 
                box-shadow: 0 0 10px rgba(39, 174, 96, 0.5);
            }
            .user-circle.receiving { 
                border-color: #e74c3c; 
                background: #fadbd8; 
                animation: glow-red 1s infinite; 
                box-shadow: 0 0 15px rgba(231, 76, 60, 0.7);
            }
            @keyframes glow-red { 
                0% { box-shadow: 0 0 5px rgba(231, 76, 60, 0.5); } 
                50% { box-shadow: 0 0 15px rgba(231, 76, 60, 0.7); } 
                100% { box-shadow: 0 0 5px rgba(231, 76, 60, 0.7); } 
            }
            .user-avatar { 
                font-size: 24px; 
                font-weight: bold; 
                color: #2c3e50;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                background: #ecf0f1;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 8px;
            }
            .log-section h2 { 
                font-size: 18px; 
                font-weight: 600; 
                color: #2c3e50; 
                margin-bottom: 12px; 
                border-bottom: 2px solid #ddd;
                padding-bottom: 6px;
            }
            .log-console {
                max-height: 250px;
                overflow-y: auto;
                background: #f9f9f9;
                border-radius: 8px;
                padding: 10px;
                border: 1px solid #eee;
            }
        </style>
    `;
}


// Route 3: User Page
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>User - Walkie Talkie</title>
    ${getCommonStyles()}
    <style> .container { max-width: 600px; } </style>
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
        
        <!-- NEW CONSOLE SECTION -->
        <div class="log-section" id="logSection">
            <h2>Transmission Log (TO / FROM Admin)</h2>
            <div class="log-console" id="transmissionConsole">
                <p class="text-center text-gray-500 italic text-sm py-4">Waiting to connect to room...</p>
            </div>
        </div>
        <!-- END NEW CONSOLE SECTION -->

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
  `);
});

// Route 4: Admin Page
app.get('/admin', (req, res) => {
  res.send(`
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
    <div class="container">
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
        
        <!-- NEW CONSOLE SECTION -->
        <div class="log-section">
            <h2>Transmission Log (FROM / TO Users)</h2>
            <div class="log-console" id="transmissionConsole">
                <p class="text-center text-gray-500 italic text-sm py-4">Connect to a room to view transmission history...</p>
            </div>
        </div>
        <!-- END NEW CONSOLE SECTION -->

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
  `);
});

// --- Socket.io Connection Handling ---
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Admin creates room
  socket.on('create-room', () => {
    const roomCode = generateRoomCode();
    const existingRoom = Array.from(rooms.values()).find(r => r.admin === socket.id);
    if (existingRoom) {
         socket.leave(existingRoom.code);
         rooms.delete(existingRoom.code);
    }
    
    const room = {
      code: roomCode,
      admin: socket.id,
      users: new Map(),
      blockedUsers: new Set(),
      adminName: 'Admin'
    };
    rooms.set(roomCode, room);
    
    socket.join(roomCode);
    console.log('Room created:', roomCode, 'by admin:', socket.id);
    socket.emit('room-created', { roomCode });
  });

  // User joins room
  socket.on('join-room', (data) => {
    const { roomCode, userName } = data;

    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: 'Room not found. Please check the room code.' });
      return;
    }
    if (socket.id === room.admin) {
        socket.join(roomCode);
        return;
    }

    if (room.blockedUsers.has(userName)) {
      socket.emit('blocked', { message: 'You are blocked from this room' });
      return;
    }
    
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
  

  // Start talking
  socket.on('start-talking', (data) => {
    const { targetUserId, roomCode } = data;

    const room = rooms.get(roomCode);
    if (!room) return;
    
    const isSenderAdmin = socket.id === room.admin;
    const speaker = isSenderAdmin ? { id: socket.id, name: 'Admin' } : room.users.get(socket.id);
    
    if (!speaker) return;
    
    let receiverId = targetUserId;
    if (!isSenderAdmin) {
        if (targetUserId !== room.admin) {
            socket.emit('error', { message: 'You can only talk to the Admin.' });
            return;
        }
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
    const sender = isSenderAdmin ? { id: socket.id, name: 'Admin' } : room.users.get(socket.id);
    
    if (!sender) return;
    
    let receiverId = targetUserId;
    if (!isSenderAdmin) {
        receiverId = room.admin;
    }
    
    if (room.blockedUsers.has(sender.name)) {
        return;
    }
    
    // Broadcast to the intended receiver AND the original sender (for echo/self-playback)
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
        
        const userEntry = Array.from(room.users.entries()).find(([id, user]) => user.name === userName);
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
  socket.on('disconnect', (reason) => {
    console.log('User disconnected:', socket.id, 'Reason:', reason);
    
    for (const [roomCode, room] of rooms.entries()) {
      if (room.admin === socket.id) {
        console.log('Admin disconnected, closing room:', roomCode);
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

