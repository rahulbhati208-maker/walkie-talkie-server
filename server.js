const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store connected clients
const clients = new Map();
const users = new Map();
const admin = {
    id: null,
    ws: null,
    online: false
};

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    console.log('New client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
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
        
        // Notify all users that admin is online
        broadcastToUsers({
            type: 'adminOnline',
            adminId: clientId
        });
        
        // Send current user list to admin
        sendUserListToAdmin();
        
        console.log(`Admin ${clientId} connected`);
        
    } else if (role === 'user') {
        users.set(clientId, { 
            id: clientId, 
            ws: ws, 
            online: true,
            connectedAt: new Date()
        });
        
        // Notify admin about new user
        if (admin.online && admin.ws) {
            admin.ws.send(JSON.stringify({
                type: 'userConnected',
                userId: clientId
            }));
            
            // Update user list for admin
            sendUserListToAdmin();
        }
        
        console.log(`User ${clientId} connected`);
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
        // Forward admin message to specific user or all users
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
        } else {
            // Broadcast to all users
            broadcastToUsers({
                type: 'chatMessage',
                text: data.text,
                senderId: admin.id,
                senderRole: 'admin'
            });
        }
    }
}

function forwardWebRTCMessage(targetId, data) {
    let targetWs = null;
    
    if (targetId === admin.id && admin.online) {
        targetWs = admin.ws;
    } else {
        const user = users.get(targetId);
        if (user && user.online) {
            targetWs = user.ws;
        }
    }
    
    if (targetWs) {
        // Modify the message to include the sender's ID
        const forwardedMessage = {
            ...data,
            from: getClientIdByWebSocket(data.fromWs || findWebSocketByClientId(data.from))
        };
        delete forwardedMessage.fromWs;
        
        targetWs.send(JSON.stringify(forwardedMessage));
    }
}

function handleDisconnection(ws) {
    const client = clients.get(ws);
    
    if (client) {
        if (client.role === 'admin') {
            // Admin disconnected
            admin.online = false;
            admin.ws = null;
            admin.id = null;
            
            // Notify all users
            broadcastToUsers({
                type: 'adminOffline'
            });
            
            console.log('Admin disconnected');
            
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
            
            console.log(`User ${client.id} disconnected`);
        }
        
        clients.delete(ws);
    }
}

function broadcastToUsers(message) {
    users.forEach((user) => {
        if (user.online && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(JSON.stringify(message));
        }
    });
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

// Start server
const PORT = process.env.PORT || 1000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket server ready for connections`);
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

module.exports = { server, wss, clients, users, admin };
