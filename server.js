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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Store rooms and users
const rooms = new Map();
const userRecordings = new Map();

// Generate 4-digit room code
function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'user.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
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
    socket.emit('room-created', { roomCode });
    console.log(`Room created: ${roomCode} by admin ${socket.id}`);
  });

  // User joins room
  socket.on('join-room', (data) => {
    const { roomCode, userName } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.blockedUsers.has(userName)) {
      socket.emit('error', { message: 'You are blocked from this room' });
      return;
    }

    room.users.set(socket.id, {
      id: socket.id,
      name: userName,
      isTalking: false
    });

    socket.join(roomCode);
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
    const room = rooms.get(roomCode);
    
    if (!room) return;

    const speaker = room.users.get(socket.id) || 
                   (socket.id === room.admin ? { id: socket.id, name: 'Admin', isTalking: true } : null);
    
    if (speaker) {
      speaker.isTalking = true;
      
      // Create recording session
      const recordingId = uuidv4();
      userRecordings.set(recordingId, {
        roomCode,
        from: speaker.name,
        to: targetUserId === 'all' ? 'All Users' : (room.users.get(targetUserId)?.name || 'Admin'),
        startTime: new Date(),
        audioData: []
      });

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
    const roomCode = Array.from(rooms.entries()).find(([code, room]) => 
      room.users.has(socket.id) || room.admin === socket.id
    )?.[0];

    if (roomCode) {
      const room = rooms.get(roomCode);
      const speaker = room.users.get(socket.id) || 
                     (socket.id === room.admin ? { id: socket.id, name: 'Admin' } : null);
      
      if (speaker) {
        speaker.isTalking = false;

        // Update recording
        const recording = userRecordings.get(recordingId);
        if (recording) {
          recording.endTime = new Date();
          recording.audioBlob = audioBlob;
        }

        // Notify all to stop talking indicators
        io.to(roomCode).emit('user-talking', {
          userId: socket.id,
          isTalking: false
        });

        // Send recording data to relevant users
        if (recording) {
          const targetSocket = recording.to === 'Admin' ? room.admin : 
                             Array.from(room.users.entries()).find(([id, user]) => user.name === recording.to)?.[0];
          
          if (targetSocket) {
            io.to(targetSocket).emit('recording-complete', {
              recordingId,
              from: recording.from,
              to: recording.to,
              timestamp: recording.startTime,
              audioBlob: audioBlob
            });
          }

          // Also send to admin for records
          io.to(room.admin).emit('recording-complete', {
            recordingId,
            from: recording.from,
            to: recording.to,
            timestamp: recording.startTime,
            audioBlob: audioBlob
          });
        }
      }
    }
  });

  // Block user
  socket.on('block-user', (data) => {
    const { roomCode, userName } = data;
    const room = rooms.get(roomCode);
    
    if (room && socket.id === room.admin) {
      room.blockedUsers.add(userName);
      
      // Find and disconnect blocked user
      const userEntry = Array.from(room.users.entries()).find(([id, user]) => user.name === userName);
      if (userEntry) {
        const [userId, user] = userEntry;
        io.to(userId).emit('blocked', { message: 'You have been blocked by admin' });
        room.users.delete(userId);
        socket.to(room.admin).emit('users-update', Array.from(room.users.values()));
      }
    }
  });

  // Disconnection handling
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Find room where this socket was admin or user
    for (const [roomCode, room] of rooms.entries()) {
      if (room.admin === socket.id) {
        // Admin disconnected - close room
        io.to(roomCode).emit('room-closed');
        rooms.delete(roomCode);
        break;
      } else if (room.users.has(socket.id)) {
        // User disconnected
        const user = room.users.get(socket.id);
        room.users.delete(socket.id);
        
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

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
