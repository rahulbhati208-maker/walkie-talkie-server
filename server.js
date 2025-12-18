const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for iframe
    methods: ["GET", "POST"]
  }
});

// Store connected users
let connectedUsers = new Map();
let stats = {
  totalToday: 0,
  peakCount: 0,
  uniqueCount: 0,
  uniqueVisitors: new Set()
};

// Main counter page - will be loaded in iframe
app.get('/', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      body { margin: 0; padding: 0; background: transparent; }
      #counter { 
        display: none; /* Hidden in iframe */
      }
    </style>
  </head>
  <body>
    <div id="counter">0</div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
      const socket = io();
      const visitorId = localStorage.getItem('visitorId') || 'visitor_' + Date.now();
      
      if (!localStorage.getItem('visitorId')) {
        localStorage.setItem('visitorId', visitorId);
      }
      
      socket.emit('join', { 
        id: visitorId,
        referer: document.referrer,
        userAgent: navigator.userAgent
      });
      
      socket.on('updateCount', (count) => {
        document.getElementById('counter').textContent = count;
        // Send to parent window
        window.parent.postMessage({ type: 'visitorCount', count: count }, '*');
      });
      
      window.addEventListener('beforeunload', () => {
        socket.emit('leave', visitorId);
      });
    </script>
  </body>
  </html>
  `);
});

// API endpoint to get count (for direct AJAX calls)
app.get('/api/count', (req, res) => {
  res.json({
    count: connectedUsers.size,
    stats: {
      totalToday: stats.totalToday,
      peakCount: stats.peakCount,
      uniqueCount: stats.uniqueCount
    }
  });
});

// Socket.io handling
io.on('connection', (socket) => {
  socket.on('join', (userData) => {
    connectedUsers.set(socket.id, {
      ...userData,
      socketId: socket.id,
      joinTime: new Date().toISOString()
    });
    
    // Update stats
    stats.totalToday++;
    stats.uniqueVisitors.add(userData.id);
    stats.uniqueCount = stats.uniqueVisitors.size;
    
    if (connectedUsers.size > stats.peakCount) {
      stats.peakCount = connectedUsers.size;
    }
    
    // Broadcast new count to all
    broadcastCount();
  });
  
  socket.on('leave', () => {
    connectedUsers.delete(socket.id);
    broadcastCount();
  });
  
  socket.on('disconnect', () => {
    connectedUsers.delete(socket.id);
    broadcastCount();
  });
});

function broadcastCount() {
  io.emit('updateCount', connectedUsers.size);
}

// Clean inactive users every 30 seconds
setInterval(() => {
  broadcastCount();
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Visitor counter running on http://localhost:${PORT}`);
});
