const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs'); // Required to read the client.js file

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e7
});

// --- Server-Side Data Stores ---
const rooms = new Map();
const transmissionLogs = new Map();

/**
 * Generates a unique 4-digit room code.
 */
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
  return code;
}

// --- Serve Client-Side JavaScript ---
// This route reads and serves the static client.js file.
app.get('/client.js', (req, res) => {
    const filePath = 'client.js';
    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'application/javascript');
        // Inject the SERVER_URL into the client script dynamically
        const clientScript = fs.readFileSync(filePath, 'utf8');
        const serverUrl = req.headers.host.includes('localhost') ? `http://${req.headers.host}` : `https://${req.headers.host}`;
        const finalScript = clientScript.replace('__SERVER_URL_PLACEHOLDER__', serverUrl);
        res.send(finalScript);
    } else {
        res.status(500).send('Error: client.js file not found on server.');
    }
});

// Placeholder routes for testing, but they won't be used by your shared host setup
app.get('/', (req, res) => res.status(200).send('Server is running. Access /user.html and /admin.html from your shared host.'));
app.get('/admin', (req, res) => res.status(200).send('Server is running. Access /user.html and /admin.html from your shared host.'));


// --- Socket.io Connection Handling (Truncated for brevity, same logic as before) ---
io.on('connection', (socket) => {
  // --- Room and User Management ---
  socket.on('create-room', (data) => {
    const { userName } = data || { userName: 'Admin' };
    const roomCode = generateRoomCode();
    
    const existingRoom = Array.from(rooms.values()).find(r => r.admin === socket.id);
    if (existingRoom) { socket.leave(existingRoom.code); rooms.delete(existingRoom.code); transmissionLogs.delete(existingRoom.code); }
    
    const room = { code: roomCode, admin: socket.id, users: new Map(), blockedUsers: new Set(), adminName: userName };
    rooms.set(roomCode, room);
    
    socket.join(roomCode);
    socket.emit('room-created', { roomCode, userName });
  });

  socket.on('join-room', (data) => {
    const { roomCode, userName } = data;
    const room = rooms.get(roomCode);
    
    if (!room) { socket.emit('error', { message: 'Room not found.' }); return; }
    if (socket.id === room.admin) { socket.join(roomCode); socket.emit('room-created', { roomCode, userName: room.adminName }); io.to(room.admin).emit('users-update', Array.from(room.users.values())); return; }
    if (room.blockedUsers.has(userName)) { socket.emit('blocked', { message: 'You are blocked from this room' }); return; }
    const existingUser = Array.from(room.users.values()).find(user => user.name === userName);
    if (existingUser) { socket.emit('error', { message: 'User name already exists.' }); return; }

    room.users.set(socket.id, { id: socket.id, name: userName, isTalking: false });
    socket.join(roomCode);
    socket.emit('room-joined', { roomCode, userName, adminId: room.admin });
    io.to(room.admin).emit('users-update', Array.from(room.users.values()));
  });

  // --- Logging and Audio Streaming ---
  socket.on('log-transmission', (logEntry) => {
      if (!transmissionLogs.has(logEntry.roomCode)) { transmissionLogs.set(logEntry.roomCode, []); }
      transmissionLogs.get(logEntry.roomCode).push(logEntry);
      io.to(logEntry.roomCode).emit('logs-update', { logs: transmissionLogs.get(logEntry.roomCode) });
  });
  
  socket.on('fetch-logs', (data) => {
      const logs = transmissionLogs.get(data.roomCode) || [];
      socket.emit('logs-update', { logs: logs });
  });
  
  socket.on('audio-data', (data) => {
    const { roomCode, audioBuffer, targetUserId, senderId } = data;
    const room = rooms.get(roomCode);
    if (!room) return;
    
    // Determine the actual receiver (Admin or User)
    const isSenderAdmin = socket.id === room.admin;
    const sender = isSenderAdmin ? { name: room.adminName } : room.users.get(socket.id);
    if (!sender || room.blockedUsers.has(sender.name)) return;
    
    const receiverId = isSenderAdmin ? targetUserId : room.admin;
    
    // Broadcast to the intended receiver AND the original sender (for echo/self-playback confirmation)
    const socketsToReceive = new Set([receiverId, senderId]);

    socketsToReceive.forEach(id => {
        io.to(id).emit('audio-data', { audioBuffer: audioBuffer, senderId: senderId, targetUserId: receiverId });
    });
  });

  // --- PTT and Control Signals ---
  socket.on('start-talking', (data) => { const room = rooms.get(data.roomCode); if (room) io.to(data.roomCode).emit('user-talking', { userId: socket.id, targetUserId: data.targetUserId, isTalking: true }); });
  socket.on('stop-talking', (data) => { const room = rooms.get(data.roomCode); if (room) io.to(data.roomCode).emit('user-talking', { userId: socket.id, isTalking: false }); });

  // --- Block/Disconnect ---
  socket.on('toggle-block-user', (data) => {
    const { roomCode, userName } = data;
    const room = rooms.get(roomCode);
    if (room && socket.id === room.admin) {
      if (room.blockedUsers.has(userName)) { room.blockedUsers.delete(userName); io.to(room.admin).emit('user-unblocked', { userName: userName }); } 
      else { 
        room.blockedUsers.add(userName); 
        const userEntry = Array.from(room.users.entries()).find(([, user]) => user.name === userName);
        if (userEntry) { const [userId] = userEntry; io.to(userId).emit('blocked', { message: 'You have been blocked by admin' }); room.users.delete(userId); io.to(room.admin).emit('users-update', Array.from(room.users.values())); }
        io.to(room.admin).emit('user-blocked', { userName: userName }); 
      }
    }
  });

  socket.on('disconnect', () => {
    for (const [roomCode, room] of rooms.entries()) {
      if (room.admin === socket.id) { io.to(roomCode).emit('room-closed', { message: 'Room closed by admin' }); rooms.delete(roomCode); transmissionLogs.delete(roomCode); break; } 
      else if (room.users.has(socket.id)) { room.users.delete(socket.id); io.to(room.admin).emit('users-update', Array.from(room.users.values())); break; }
    }
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port', PORT);
});

