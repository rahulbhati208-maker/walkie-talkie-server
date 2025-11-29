// IMPORTANT: This placeholder will be replaced by the actual Node.js server URL upon serving.
const SERVER_URL = "__SERVER_URL_PLACEHOLDER__";

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

// --- WAV CONVERSION UTILITY (To solve MP3/WebM compatibility for downloads) ---
function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // Linear PCM
    view.setUint16(22, 1, true); // Channels
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte Rate
    view.setUint16(32, 2, true); // Block Align
    view.setUint16(34, 16, true); // Bits per Sample
    
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);
    
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
        this.logs = []; 
        this.users = new Map();

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
        if (this.socket) { this.socket.disconnect(); }

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
            
            if (reason === 'io server disconnect') { this.socket.connect(); } else { this.scheduleReconnect(); }
        });

        this.socket.on('connect_error', () => {
            this.updateConnectionStatus('error');
            this.scheduleReconnect();
        });

        this.setupSocketListeners();
    }

    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            this.reconnectTimeout = setTimeout(() => { this.connectToServer(); }, delay);
        } else {
            this.showError('Unable to connect to server. Please refresh the page.');
        }
    }

    setupAutoReconnect() {
        window.addEventListener('online', () => { if (this.socket && !this.socket.connected) { this.connectToServer(); } });
        window.addEventListener('beforeunload', () => {
            if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); }
            if (this.socket) { this.socket.disconnect(); }
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
                this.users = new Map(users.map(u => [u.id, u])); 
                this.updateUsersList(users);
            }
        });
        
        this.socket.on('logs-update', (data) => {
            if (this.roomCode === data.roomCode) {
                this.logs = data.logs;
                this.renderLogConsole(this.logs);
            }
        });

        this.socket.on('user-talking', (data) => { this.updateTalkingIndicator(data.userId, data.targetUserId, data.isTalking); });
        this.socket.on('audio-data', (data) => { if (this.socket.id === data.targetUserId || this.socket.id === data.senderId) { this.playAudio(data.audioBuffer, 16000); } });
        this.socket.on('user-left', (data) => { this.removeUserFromUI(data.userId); });
        this.socket.on('error', (data) => { this.showError(data.message); });
        this.socket.on('room-closed', () => { this.showError('Room has been closed by admin'); this.leaveRoom(); });
        this.socket.on('user-blocked', (data) => { if (this.isAdmin) { this.blockedUsers.add(data.userName); this.updateBlockButton(data.userName, true); } });
        this.socket.on('user-unblocked', (data) => { if (this.isAdmin) { this.blockedUsers.delete(data.userName); this.updateBlockButton(data.userName, false); } });
    }

    createRoom() {
        if (!this.socket.connected) { this.showError('Not connected to server'); return; }
        this.socket.emit('create-room', { userName: this.userName });
    }

    joinRoom() {
        const userNameInput = document.getElementById('userName');
        const roomCodeInput = document.getElementById('roomCode');
        const userName = userNameInput.value.trim();
        const roomCode = roomCodeInput.value.trim();

        if (!userName) { this.showError('Please enter your name'); return; }
        if (!roomCode || roomCode.length !== 4 || !/^\\d{4}$/.test(roomCode)) { this.showError('Please enter a valid 4-digit room code'); return; }

        this.userName = userName;
        this.socket.emit('join-room', { roomCode, userName });
    }

    async startTalking(targetUserId) {
        if (!this.roomCode || !this.socket.connected || this.isTalking) return; 
        try { this.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 } }); } catch (e) { this.showError('Microphone access denied. Cannot start talk session.'); return; }

        const finalTargetId = this.isAdmin ? targetUserId : this.currentTalkingTo;
        if (!finalTargetId) { this.showError('No target selected or no admin in room.'); return; }

        this.isTalking = true;
        this.currentTalkingTo = finalTargetId;
        
        if (!this.isAdmin) {
            const talkBtn = document.getElementById('talkBtn');
            if (talkBtn) { talkBtn.classList.add('talking'); talkBtn.textContent = 'RELEASE TO SEND'; }
            const userStatus = document.getElementById('userStatus');
            if (userStatus) userStatus.classList.add('active');
        } else { this.updateAdminTalkButtons(finalTargetId); }
        
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
        } else { this.updateAdminTalkButtons(null); }

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
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => { resolve(reader.result.split(',')[1]); };
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
        } else { return 'Admin'; }
    }
    
    // --- DOWNLOAD LOGIC (WAV & ZIP) ---
    async getWavData(base64Webm) {
        const blob = new Blob([base64ToBinaryArrayBuffer(base64Webm)], { type: 'audio/webm' });
        
        return new Promise(async (resolve, reject) => {
            try {
                const arrayBuffer = await blob.arrayBuffer();
                const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                const decodedAudio = await audioContext.decodeAudioData(arrayBuffer);
                
                const samplesFloat32 = decodedAudio.getChannelData(0);
                const samplesInt16 = new Int16Array(samplesFloat32.length);
                for (let i = 0; i < samplesFloat32.length; i++) { samplesInt16[i] = Math.max(-32768, Math.min(32767, samplesFloat32[i] * 32768)); }
                
                const wavBlob = encodeWAV(samplesInt16, decodedAudio.sampleRate);
                resolve(wavBlob);
            } catch (error) { reject(error); }
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
            
            const statusSpan = logItem.querySelector('.download-status');
            if(statusSpan) statusSpan.innerHTML = '✅';
            
        }).catch(e => { this.showError('Download failed (WAV conversion error): ' + e.message); });
    }

    async downloadAllLogsAsZip() {
        if (!window.JSZip) { this.showError('JSZip library not loaded. Cannot download ZIP.'); return; }
        const zip = new JSZip();
        this.showSuccess('Preparing to download ' + this.logs.length + ' files...');

        const downloadPromises = this.logs.map(async (log) => {
            try {
                const wavBlob = await this.getWavData(log.audioBase64, 16000);
                const date = new Date(log.timestamp);
                const dateString = date.toISOString().split('T')[0];
                const timeString = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/:/g, '-');
                
                const filename = `\${timeString}_\${log.senderName}_to_\${log.receiverName}.wav`;
                
                if (this.isAdmin) {
                    const senderFolder = log.senderName;
                    zip.folder(dateString).folder(senderFolder).file(filename, wavBlob);
                } else {
                    zip.file(filename, wavBlob);
                }

            } catch (e) { console.error('Failed to convert log for ZIP:', e); }
        });

        await Promise.all(downloadPromises);

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transmissions_\${this.roomCode}_\${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showSuccess('All logs downloaded as ZIP!');
    }
    
    // --- Audio Streaming ---
    async startAudioStreaming() {
        try {
            if (!this.audioContext) { this.audioContext = new (window.AudioContext || window.webkitAudioContext)(); }
            if (this.audioContext.state === 'suspended') { await this.audioContext.resume().catch(err => console.error("Failed to resume audio context:", err)); }
            this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.localStream);
            this.scriptProcessor = this.audioContext.createScriptProcessor(1024, 1, 1);

            this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                if (this.isTalking && this.socket.connected) {
                    const inputBuffer = audioProcessingEvent.inputBuffer;
                    const inputData = inputBuffer.getChannelData(0);
                    const int16Data = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) { int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768)); }
                    
                    this.socket.emit('audio-data', {
                        audioBuffer: int16Data.buffer,
                        senderId: this.socket.id, 
                        targetUserId: this.currentTalkingTo,
                        roomCode: this.roomCode
                    });
                }
            };
            this.mediaStreamSource.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);
        } catch (error) { this.showError('Could not start microphone stream. Check permissions and try again.'); this.stopTalking(); }
    }

    stopAudioStreaming() {
        if (this.scriptProcessor) { this.scriptProcessor.disconnect(); this.scriptProcessor = null; }
        if (this.mediaStreamSource) { this.mediaStreamSource.disconnect(); this.mediaStreamSource = null; }
    }
    
    async playAudio(audioBuffer, sampleRate) {
        try {
            if (!this.audioContext) { this.audioContext = new (window.AudioContext || window.webkitAudioContext)(); }
            if (this.audioContext.state === 'suspended') { await this.audioContext.resume().catch(err => console.error("Failed to resume audio context:", err)); }

            const int16Data = new Int16Array(audioBuffer);
            const float32Data = new Float32Array(int16Data.length);
            for (let i = 0; i < int16Data.length; i++) { float32Data[i] = int16Data[i] / 32768; }

            const incomingAudioBuffer = this.audioContext.createBuffer(1, float32Data.length, sampleRate);
            incomingAudioBuffer.getChannelData(0).set(float32Data);

            const source = this.audioContext.createBufferSource();
            source.buffer = incomingAudioBuffer;
            source.connect(this.audioContext.destination);
            source.start(0); 
            
        } catch (error) { console.error('Error playing audio:', error); }
    }

    // --- UI Update Logic ---
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
            const activeBtn = document.querySelector(`.talk-btn-mini[data-user-id="\${activeUserId}"]`);
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

    addUserToUI(userId, userName) {
        const usersList = document.getElementById('usersList');
        if (!usersList) return;

        let userCircle = document.getElementById('user-' + userId);
        if (userCircle) return;
        
        userCircle = document.createElement('div');
        userCircle.className = 'user-circle';
        userCircle.id = 'user-' + userId;
        userCircle.innerHTML = `
            <div class="user-avatar">\${userName.charAt(0).toUpperCase()}</div>
            <div class="user-name">\${userName}</div>
            <div class="user-controls">
                <button class="talk-btn-mini" data-user-id="\${userId}" data-user-name="\${userName}">Talk</button>
                <button class="block-btn text-xs bg-red-500 hover:bg-red-600 text-white p-1 rounded" data-user-name="\${userName}">Block</button>
            </div>
        `;

        usersList.appendChild(userCircle);

        userCircle.querySelector('.talk-btn-mini').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleAdminTalking(userId);
        });

        userCircle.querySelector('.block-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleBlockUser(userName);
        });
        
        this.updateBlockButton(userName, this.blockedUsers.has(userName));
    }

    removeUserFromUI(userId) {
        const userElement = document.getElementById('user-' + userId);
        if (userElement) { userElement.remove(); }
    }

    updateUsersList(users) {
        const usersList = document.getElementById('usersList');
        if (!usersList) return;
        usersList.innerHTML = '';
        users.forEach(user => { this.addUserToUI(user.id, user.name); });
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
    
    toggleBlockUser(userName) {
        if (this.roomCode) { this.socket.emit('toggle-block-user', { roomCode: this.roomCode, userName: userName }); }
    }

    updateBlockButton(userName, isBlocked) {
        const blockBtn = document.querySelector(`.block-btn[data-user-name="\${userName}"]`);
        if (blockBtn) {
            if (isBlocked) {
                blockBtn.textContent = 'Unblock';
                blockBtn.classList.add('blocked');
                blockBtn.classList.remove('bg-red-500');
                blockBtn.classList.add('bg-gray-500');
            } else {
                blockBtn.textContent = 'Block';
                blockBtn.classList.remove('blocked');
                blockBtn.classList.remove('bg-gray-500');
                blockBtn.classList.add('bg-red-500');
            }
        }
    }
    
    leaveRoom() {
        this.stopAudioStreaming();
        this.roomCode = null;
        localStorage.removeItem('walkieRoomCode');
        
        if (this.isAdmin) {
            document.getElementById('roomCode').textContent = '----';
            document.getElementById('usersList').innerHTML = '';
        } else {
            document.getElementById('joinSection').classList.remove('hidden');
            document.getElementById('chatSection').classList.add('hidden');
        }
    }
    
    showSuccess(message) {
        const successElement = document.getElementById('successMessage');
        if (successElement) {
            successElement.textContent = message;
            successElement.classList.remove('hidden');
            setTimeout(() => { successElement.classList.add('hidden'); }, 3000);
        }
    }

    showError(message) {
        const errorElement = document.getElementById('errorMessage');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.remove('hidden');
            setTimeout(() => { errorElement.classList.add('hidden'); }, 5000);
        }
    }
}

