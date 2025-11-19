const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Map();
const users = new Map();
const admin = {
    id: null,
    ws: null,
    online: false
};

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    console.log('New client connected');
    console.log('Client IP:', req.socket.remoteAddress);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data.type, 'from:', data.id);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Error parsing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        handleDisconnection(ws);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        handleDisconnection(ws);
    });
});

function handleMessage(ws, data) {
    switch (data.type) {
        case 'identify':
            handleIdentification(ws, data);
            break;
            
        case 'chatMessage':
            handleChatMessage(ws, data);
            break;
            
        case 'webrtcOffer':
            forwardWebRTCMessage(data.targetId, data);
            break;
            
        case 'webrtcAnswer':
            forwardWebRTCMessage(data.targetId, data);
            break;
            
        case 'iceCandidate':
            forwardWebRTCMessage(data.targetId, data);
            break;
            
        default:
            console.log('Unknown message type:', data.type);
    }
}

function handleIdentification(ws, data) {
    const clientId = data.id;
    const role = data.role;
    
    clients.set(ws, { id: clientId, role: role });
    
    if (role === 'admin') {
        admin.id = clientId;
        admin.ws = ws;
        admin.online = true;
        
        console.log(`Admin ${clientId} connected`);
        
        // Notify all users that admin is online
        broadcastToUsers({
            type: 'adminOnline',
            adminId: clientId
        });
        
        // Send current user list to admin
        sendUserListToAdmin();
        
    } else if (role === 'user') {
        users.set(clientId, { 
            id: clientId, 
            ws: ws, 
            online: true,
            connectedAt: new Date()
        });
        
        console.log(`User ${clientId} connected`);
        
        // Notify admin about new user
        if (admin.online && admin.ws) {
            admin.ws.send(JSON.stringify({
                type: 'userConnected',
                userId: clientId
            }));
            
            // Update user list for admin
            sendUserListToAdmin();
        }
    }
    
    // Send confirmation to client
    ws.send(JSON.stringify({
        type: 'identified',
        id: clientId,
        role: role
    }));
}

function handleChatMessage(ws, data) {
    const client = clients.get(ws);
    if (!client) return;
    
    console.log(`Chat message from ${client.role} ${client.id}:`, data.text);
    
    if (client.role === 'user') {
        // Forward user message to admin
        if (admin.online && admin.ws) {
            admin.ws.send(JSON.stringify({
                type: 'chatMessage',
                text: data.text,
                senderId: client.id,
                senderRole: 'user'
            }));
        }
    } else if (client.role === 'admin') {
        // Forward admin message to specific user
        if (data.targetId) {
            const targetUser = users.get(data.targetId);
            if (targetUser && targetUser.online) {
                targetUser.ws.send(JSON.stringify({
                    type: 'chatMessage',
                    text: data.text,
                    senderId: admin.id,
                    senderRole: 'admin'
                }));
            }
        }
    }
}

function forwardWebRTCMessage(targetId, data) {
    console.log(`Forwarding WebRTC ${data.type} to ${targetId}`);
    
    let targetWs = null;
    
    if (targetId === admin.id && admin.online) {
        targetWs = admin.ws;
    } else {
        const user = users.get(targetId);
        if (user && user.online) {
            targetWs = user.ws;
        }
    }
    
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        // Add from field to identify sender
        const senderWs = findWebSocketByClientId(data.from);
        const senderClient = clients.get(senderWs);
        
        const forwardedMessage = {
            ...data,
            from: data.from
        };
        
        targetWs.send(JSON.stringify(forwardedMessage));
        console.log(`WebRTC message forwarded to ${targetId}`);
    } else {
        console.log(`Target ${targetId} not found or not connected`);
    }
}

function handleDisconnection(ws) {
    const client = clients.get(ws);
    
    if (client) {
        console.log(`${client.role} ${client.id} disconnected`);
        
        if (client.role === 'admin') {
            // Admin disconnected
            admin.online = false;
            admin.ws = null;
            admin.id = null;
            
            // Notify all users
            broadcastToUsers({
                type: 'adminOffline'
            });
            
        } else if (client.role === 'user') {
            // User disconnected
            users.delete(client.id);
            
            // Notify admin
            if (admin.online && admin.ws) {
                admin.ws.send(JSON.stringify({
                    type: 'userDisconnected',
                    userId: client.id
                }));
                
                // Update user list for admin
                sendUserListToAdmin();
            }
        }
        
        clients.delete(ws);
    }
}

function broadcastToUsers(message) {
    let count = 0;
    users.forEach((user) => {
        if (user.online && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(JSON.stringify(message));
            count++;
        }
    });
    console.log(`Broadcasted to ${count} users`);
}

function sendUserListToAdmin() {
    if (admin.online && admin.ws) {
        const userList = Array.from(users.values()).map(user => ({
            id: user.id,
            online: user.online,
            connectedAt: user.connectedAt
        }));
        
        admin.ws.send(JSON.stringify({
            type: 'userList',
            users: userList
        }));
        
        console.log(`Sent user list to admin: ${userList.length} users`);
    }
}

function getClientIdByWebSocket(ws) {
    const client = clients.get(ws);
    return client ? client.id : null;
}

function findWebSocketByClientId(clientId) {
    for (let [ws, client] of clients.entries()) {
        if (client.id === clientId) {
            return ws;
        }
    }
    return null;
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        connectedClients: clients.size,
        connectedUsers: Array.from(users.values()).filter(user => user.online).length,
        adminOnline: admin.online,
        timestamp: new Date().toISOString()
    });
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to get server status
app.get('/api/status', (req, res) => {
    res.json({
        server: 'walkie-talkie-server',
        version: '1.0.0',
        status: 'running',
        connectedClients: clients.size,
        connectedUsers: Array.from(users.values()).filter(user => user.online).length,
        adminOnline: admin.online,
        uptime: process.uptime()
    });
});

// Start server
const PORT = process.env.PORT || 1000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 WebSocket server ready for connections`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Status API: http://localhost:${PORT}/api/status`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    
    // Close all WebSocket connections
    wss.clients.forEach(client => {
        client.close();
    });
    
    server.close(() => {
        console.log('Server shut down');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = { server, wss, clients, users, admin };
