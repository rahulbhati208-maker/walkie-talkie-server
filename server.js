const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Store connected users
let connectedUsers = new Map(); // socketId -> userData

app.use(express.static('public'));

// Serve HTML page
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Live Visitor Counter</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }
            
            body {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
            }
            
            .container {
                background: white;
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                padding: 40px;
                text-align: center;
                max-width: 800px;
                width: 100%;
            }
            
            h1 {
                color: #4f46e5;
                font-size: 2.5rem;
                margin-bottom: 10px;
            }
            
            .counter-container {
                margin: 40px 0;
            }
            
            .counter {
                font-size: 8rem;
                font-weight: bold;
                color: #4f46e5;
                text-shadow: 0 10px 20px rgba(79, 70, 229, 0.3);
                line-height: 1;
            }
            
            .counter-label {
                font-size: 1.5rem;
                color: #64748b;
                margin-top: 10px;
            }
            
            .visitors-list {
                margin-top: 40px;
                background: #f8fafc;
                border-radius: 15px;
                padding: 25px;
                max-height: 300px;
                overflow-y: auto;
            }
            
            .visitors-list h3 {
                color: #4f46e5;
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 2px solid #e2e8f0;
            }
            
            .visitor-item {
                display: flex;
                align-items: center;
                padding: 15px;
                background: white;
                border-radius: 10px;
                margin-bottom: 10px;
                border-left: 4px solid #4f46e5;
            }
            
            .visitor-info {
                flex: 1;
                text-align: left;
            }
            
            .visitor-name {
                font-weight: 600;
                color: #1e293b;
            }
            
            .visitor-time {
                font-size: 0.9rem;
                color: #64748b;
            }
            
            .status-indicator {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: #10b981;
                margin-right: 10px;
            }
            
            .stats {
                display: flex;
                justify-content: space-around;
                margin-top: 30px;
                padding-top: 20px;
                border-top: 2px solid #e2e8f0;
            }
            
            .stat-item {
                text-align: center;
            }
            
            .stat-number {
                font-size: 2rem;
                font-weight: bold;
                color: #4f46e5;
            }
            
            .stat-label {
                font-size: 1rem;
                color: #64748b;
            }
            
            .refresh-info {
                margin-top: 20px;
                color: #64748b;
                font-size: 0.9rem;
            }
            
            .pulse {
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }
            
            .new-user {
                animation: highlight 1s ease-out;
            }
            
            @keyframes highlight {
                0% { background-color: #dbeafe; }
                100% { background-color: white; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🌐 Live Visitor Counter</h1>
            <p>See how many people are currently viewing this page in real-time</p>
            
            <div class="counter-container">
                <div class="counter pulse" id="counter">0</div>
                <div class="counter-label">People Online Right Now</div>
            </div>
            
            <div class="visitors-list" id="visitorsList">
                <h3>Current Visitors</h3>
                <div id="visitorsContainer">
                    <!-- Visitors will appear here -->
                </div>
            </div>
            
            <div class="stats">
                <div class="stat-item">
                    <div class="stat-number" id="totalToday">0</div>
                    <div class="stat-label">Total Today</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number" id="peakCount">0</div>
                    <div class="stat-label">Peak Today</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number" id="uniqueCount">0</div>
                    <div class="stat-label">Unique Visitors</div>
                </div>
            </div>
            
            <div class="refresh-info">
                This counter updates in real-time. Open this page in multiple tabs/browsers to see it change!
            </div>
        </div>
        
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            let myVisitorId = localStorage.getItem('visitorId') || 'visitor_' + Date.now();
            
            // Store in localStorage for returning visitors
            if (!localStorage.getItem('visitorId')) {
                localStorage.setItem('visitorId', myVisitorId);
            }
            
            // Generate random name for display
            const names = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Riley', 'Morgan', 'Quinn'];
            const myName = names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 100);
            
            // Connect to server
            socket.emit('join', {
                id: myVisitorId,
                name: myName,
                joinTime: new Date().toISOString()
            });
            
            // Update counter
            socket.on('updateCounter', (data) => {
                const { count, visitors, stats } = data;
                
                // Update counter
                document.getElementById('counter').textContent = count;
                
                // Add pulse animation
                document.getElementById('counter').classList.add('pulse');
                setTimeout(() => {
                    document.getElementById('counter').classList.remove('pulse');
                }, 500);
                
                // Update visitors list
                const container = document.getElementById('visitorsContainer');
                container.innerHTML = '';
                
                visitors.forEach(visitor => {
                    const div = document.createElement('div');
                    div.className = 'visitor-item';
                    if (visitor.id === myVisitorId) {
                        div.style.borderLeftColor = '#10b981';
                    }
                    
                    const joinTime = new Date(visitor.joinTime);
                    const timeStr = joinTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    
                    div.innerHTML = \`
                        <div class="status-indicator"></div>
                        <div class="visitor-info">
                            <div class="visitor-name">\${visitor.name} \${visitor.id === myVisitorId ? '(You)' : ''}</div>
                            <div class="visitor-time">Joined at \${timeStr}</div>
                        </div>
                    \`;
                    
                    container.appendChild(div);
                });
                
                // Update stats
                document.getElementById('totalToday').textContent = stats.totalToday;
                document.getElementById('peakCount').textContent = stats.peakCount;
                document.getElementById('uniqueCount').textContent = stats.uniqueCount;
            });
            
            // Show notification for new visitor
            socket.on('newVisitor', (visitor) => {
                if (visitor.id !== myVisitorId) {
                    showNotification(\`\${visitor.name} joined the page!\`);
                }
            });
            
            // Show notification for leaving visitor
            socket.on('visitorLeft', (visitor) => {
                showNotification(\`\${visitor.name} left the page\`);
            });
            
            // Notification function
            function showNotification(message) {
                // Create notification element
                const notification = document.createElement('div');
                notification.style.cssText = \`
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #4f46e5;
                    color: white;
                    padding: 15px 25px;
                    border-radius: 10px;
                    box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                    z-index: 1000;
                    animation: slideIn 0.3s ease-out;
                \`;
                
                notification.textContent = message;
                document.body.appendChild(notification);
                
                // Remove after 3 seconds
                setTimeout(() => {
                    notification.style.animation = 'slideOut 0.3s ease-out';
                    setTimeout(() => {
                        document.body.removeChild(notification);
                    }, 300);
                }, 3000);
                
                // Add keyframes for animation
                if (!document.getElementById('notificationStyles')) {
                    const style = document.createElement('style');
                    style.id = 'notificationStyles';
                    style.textContent = \`
                        @keyframes slideIn {
                            from { transform: translateX(100%); opacity: 0; }
                            to { transform: translateX(0); opacity: 1; }
                        }
                        @keyframes slideOut {
                            from { transform: translateX(0); opacity: 1; }
                            to { transform: translateX(100%); opacity: 0; }
                        }
                    \`;
                    document.head.appendChild(style);
                }
            }
            
            // Handle page visibility change
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    // Page is hidden
                    socket.emit('userActivity', { id: myVisitorId, active: false });
                } else {
                    // Page is visible again
                    socket.emit('userActivity', { id: myVisitorId, active: true });
                }
            });
            
            // Handle beforeunload
            window.addEventListener('beforeunload', () => {
                socket.emit('leave', myVisitorId);
            });
            
            // Periodic ping to stay connected
            setInterval(() => {
                socket.emit('ping', myVisitorId);
            }, 30000);
        </script>
    </body>
    </html>
    `);
});

// Statistics
let stats = {
    totalToday: 0,
    peakCount: 0,
    uniqueCount: 0,
    uniqueVisitors: new Set()
};

// Track daily reset
let lastReset = new Date().toDateString();

function resetDailyStats() {
    const today = new Date().toDateString();
    if (today !== lastReset) {
        stats.totalToday = 0;
        stats.peakCount = 0;
        stats.uniqueCount = 0;
        stats.uniqueVisitors.clear();
        lastReset = today;
    }
}

// Socket.io handling
io.on('connection', (socket) => {
    console.log('New connection:', socket.id);
    
    socket.on('join', (userData) => {
        // Reset stats if new day
        resetDailyStats();
        
        // Add user to connected users
        connectedUsers.set(socket.id, {
            ...userData,
            socketId: socket.id,
            joinTime: new Date().toISOString(),
            lastActive: Date.now(),
            active: true
        });
        
        // Update stats
        stats.totalToday++;
        stats.uniqueVisitors.add(userData.id);
        stats.uniqueCount = stats.uniqueVisitors.size;
        
        // Update peak count
        if (connectedUsers.size > stats.peakCount) {
            stats.peakCount = connectedUsers.size;
        }
        
        // Notify all clients about new user
        socket.broadcast.emit('newVisitor', userData);
        
        // Send updated count to all clients
        updateAllClients();
    });
    
    socket.on('userActivity', (data) => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            user.active = data.active;
            user.lastActive = Date.now();
            updateAllClients();
        }
    });
    
    socket.on('ping', (visitorId) => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            user.lastActive = Date.now();
        }
    });
    
    socket.on('leave', (visitorId) => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            // Notify other clients
            socket.broadcast.emit('visitorLeft', user);
            
            // Remove user
            connectedUsers.delete(socket.id);
            
            // Update all clients
            updateAllClients();
        }
    });
    
    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            // Notify other clients
            socket.broadcast.emit('visitorLeft', user);
            
            // Remove user
            connectedUsers.delete(socket.id);
            
            // Update all clients
            updateAllClients();
        }
    });
});

function updateAllClients() {
    const visitors = Array.from(connectedUsers.values()).map(user => ({
        id: user.id,
        name: user.name,
        joinTime: user.joinTime,
        active: user.active,
        lastActive: user.lastActive
    }));
    
    // Sort by join time (newest first)
    visitors.sort((a, b) => new Date(b.joinTime) - new Date(a.joinTime));
    
    io.emit('updateCounter', {
        count: connectedUsers.size,
        visitors: visitors,
        stats: {
            totalToday: stats.totalToday,
            peakCount: stats.peakCount,
            uniqueCount: stats.uniqueCount
        }
    });
}

// Clean up inactive users (30 seconds timeout)
setInterval(() => {
    const now = Date.now();
    let changed = false;
    
    for (const [socketId, user] of connectedUsers.entries()) {
        if (now - user.lastActive > 30000) { // 30 seconds
            connectedUsers.delete(socketId);
            changed = true;
        }
    }
    
    if (changed) {
        updateAllClients();
    }
}, 10000); // Check every 10 seconds

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Live Visitor Counter running on http://localhost:${PORT}`);
    console.log('Open this URL in multiple tabs/browsers to see the counter increase!');
});
