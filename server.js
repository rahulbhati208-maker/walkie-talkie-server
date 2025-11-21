// server/server.js
/* Walkie-talkie signalling + static server
   - Serves frontend from ../frontend (or ./frontend)
   - Socket.IO handles register, signal, rename, speaking, who_is_admin
   - Simple persistent clients store to clients.json
*/

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'clients.json'); // persisted store
const FRONTEND_PATHS = [
  path.join(__dirname, '../frontend'),
  path.join(__dirname, './frontend')
];

// Load or init clients store
let clients = {}; // clientId -> { clientId, name, role, socketId, lastSeen }
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8') || '{}';
    clients = JSON.parse(raw);
  }
} catch (e) {
  console.error('Failed to read clients.json', e);
  clients = {};
}

function persistClients() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(clients, null, 2));
  } catch (e) {
    console.error('Failed to persist clients.json', e);
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6
});

// Serve frontend static files (if present)
let staticServed = false;
for (const p of FRONTEND_PATHS) {
  if (fs.existsSync(p)) {
    app.use(express.static(p));
    console.log('Serving static frontend from', p);
    staticServed = true;
    break;
  }
}
if (!staticServed) {
  console.log('No frontend static folder found in expected paths. Create frontend/ with admin.html & user.html.');
}

// Simple REST status
app.get('/status', (req, res) => {
  res.json({ ok: true, time: Date.now(), clientsCount: Object.keys(clients).length });
});

// server state
let currentSpeaker = null; // clientId of active speaker (only one allowed)

// util: build client list array to send to clients (don't leak socketIds)
function buildClientsList() {
  return Object.values(clients).map(c => ({
    clientId: c.clientId,
    name: c.name || null,
    role: c.role || 'user',
    online: !!c.socketId,
    lastSeen: c.lastSeen || null
  }));
}

// helpers
function broadcastClientsList() {
  io.emit('clients_list', buildClientsList());
}

// On socket connection
io.on('connection', (socket) => {
  console.log('[IO] socket connected', socket.id);

  // register: { clientId, role, name }
  socket.on('register', (payload = {}) => {
    try {
      const { clientId, role = 'user', name } = payload;
      if (!clientId) {
        socket.emit('register_ack', { ok: false, error: 'clientId required' });
        return;
      }
      clients[clientId] = clients[clientId] || { clientId };
      clients[clientId].socketId = socket.id;
      clients[clientId].role = role;
      if (name) clients[clientId].name = name;
      clients[clientId].lastSeen = Date.now();
      socket.data.clientId = clientId;
      socket.data.role = role;

      // send ack with known adminId (if any) and full list
      const adminEntry = Object.values(clients).find(c => c.role === 'admin' && !!c.socketId);
      socket.emit('register_ack', { ok: true, adminId: adminEntry ? adminEntry.clientId : null, clients: buildClientsList() });

      broadcastClientsList();
      persistClients();
      console.log(`[register] ${clientId} (${role}) registered`);
    } catch (e) {
      console.error('register error', e);
    }
  });

  // who_is_admin: callback style
  socket.on('who_is_admin', (payload, cb) => {
    const admin = Object.values(clients).find(c => c.role === 'admin' && !!c.socketId);
    const adminId = admin ? admin.clientId : null;
    if (typeof cb === 'function') cb({ adminId });
    else socket.emit('who_is_admin_resp', { adminId });
  });

  // signal relay: { to, from, data }
  socket.on('signal', (payload) => {
    try {
      const { to, from, data } = payload || {};
      if (!to || !data) return;
      const target = clients[to];
      if (target && target.socketId) {
        io.to(target.socketId).emit('signal', { from, data });
      } else {
        // recipient offline -> inform sender
        socket.emit('signal_error', { error: 'target_offline', to });
      }
    } catch (e) {
      console.error('signal error', e);
    }
  });

  // rename: admin can rename users (or any client can rename themselves)
  socket.on('rename', ({ clientId, name }) => {
    if (!clientId || typeof name !== 'string') return;
    if (!clients[clientId]) clients[clientId] = { clientId };
    clients[clientId].name = name;
    clients[clientId].lastSeen = Date.now();
    persistClients();
    broadcastClientsList();
    console.log(`[rename] ${clientId} => ${name}`);
  });

  // speaking: { clientId, speaking: boolean }
  socket.on('speaking', ({ clientId, speaking }) => {
    try {
      if (!clientId) return;
      // If trying to start speaking
      if (speaking) {
        // if someone else is speaking -> reject
        if (currentSpeaker && currentSpeaker !== clientId) {
          // tell the requester they are blocked/busy
          const requester = clients[clientId] && clients[clientId].socketId ? io.to(clients[clientId].socketId) : null;
          if (requester) requester.emit('speaking_denied', { reason: 'busy', currentSpeaker });
          return;
        }
        // grant speaking
        currentSpeaker = clientId;
        io.emit('speaking', { clientId, speaking: true });
        console.log(`[speaking] ${clientId} started`);
      } else {
        // stopping speaking
        if (currentSpeaker === clientId) {
          currentSpeaker = null;
        }
        io.emit('speaking', { clientId, speaking: false });
        console.log(`[speaking] ${clientId} stopped`);
      }
    } catch (e) {
      console.error('speaking event error', e);
    }
  });

  // ping/pong check
  socket.on('ping_check', () => socket.emit('pong_check', Date.now()));

  socket.on('disconnect', (reason) => {
    const clientId = socket.data.clientId;
    if (clientId && clients[clientId]) {
      // mark offline but keep record (so admin names persist)
      clients[clientId].socketId = null;
      clients[clientId].lastSeen = Date.now();
      // if they were current speaker, clear
      if (currentSpeaker === clientId) {
        currentSpeaker = null;
        io.emit('speaking', { clientId, speaking: false });
      }
      persistClients();
      broadcastClientsList();
      console.log('[disconnect]', clientId, 'reason:', reason);
    } else {
      console.log('[disconnect] socket with no clientId', socket.id);
    }
  });
});

// Startup
server.listen(PORT, () => {
  console.log(`Walkie signalling server listening on port ${PORT}`);
  console.log(`Status endpoint: /status`);
});
