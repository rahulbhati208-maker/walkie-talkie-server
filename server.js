// server.js
// Walkie-talkie signalling server (private admin<->user mode + optional admin broadcast)
// Node >= 18 recommended.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'clients.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 5e7 });

// serve frontend folder optionally
const FRONT = path.join(__dirname, 'frontend');
if (fs.existsSync(FRONT)) {
  app.use(express.static(FRONT));
  console.log('Serving static frontend from', FRONT);
}

// persistence for clients (names and lastSeen)
let clients = {}; // clientId -> { clientId, name, role, socketId, lastSeen }
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8') || '{}';
    clients = JSON.parse(raw);
  }
} catch (e) {
  console.warn('Failed to load clients.json:', e);
  clients = {};
}

function persistClients() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(clients, null, 2));
  } catch (e) {
    console.warn('Failed to persist clients.json:', e);
  }
}

function buildClientsList() {
  return Object.values(clients).map(c => ({
    clientId: c.clientId,
    name: c.name || null,
    role: c.role || 'user',
    online: !!c.socketId,
    lastSeen: c.lastSeen || null
  }));
}

function broadcastClientsList() {
  io.emit('clients_list', buildClientsList());
}

// activeSessions map: key = `${from}::${to}`
// value = { from, to, startTs, bytes }
const activeSessions = {}; // used to summarize on stop_talk

// helper to start/ensure session
function ensureSession(from, to) {
  const key = `${from}::${to}`;
  if (!activeSessions[key]) {
    activeSessions[key] = { from, to, startTs: Date.now(), bytes: 0 };
  }
  return activeSessions[key];
}

// helper to stop session and emit summary
function endSessionAndEmitSummary(from, to) {
  const key = `${from}::${to}`;
  const s = activeSessions[key];
  if (!s) return;
  const duration = Math.round((Date.now() - s.startTs) / 1000);
  const entry = { from: s.from, to: s.to, ts: Date.now(), duration, bytes: s.bytes || 0 };
  // emit chat_log to admin consoles and clients (UI will place appropriately)
  io.emit('chat_log', entry);
  delete activeSessions[key];
}

// handle binary buffer size detection uniformly
function bufferByteLength(buf) {
  if (!buf) return 0;
  if (Buffer.isBuffer(buf)) return buf.length;
  // For ArrayBuffer-like
  if (buf.byteLength !== undefined) return buf.byteLength;
  // For Blob (unlikely in Node), try size
  if (buf.size !== undefined) return buf.size;
  return 0;
}

io.on('connection', (socket) => {
  console.log('[io] connect', socket.id);

  // Register: { clientId, role, name }
  socket.on('register', (payload = {}) => {
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
    persistClients();
    socket.emit('register_ack', { ok: true });
    broadcastClientsList();
    console.log(`[register] ${clientId} (${role}) ${clients[clientId].name || ''}`);
  });

  // Request clients list (on demand)
  socket.on('request_clients', () => {
    socket.emit('clients_list', buildClientsList());
  });

  // who_is_admin callback
  socket.on('who_is_admin', (payload, cb) => {
    const adm = Object.values(clients).find(c => c.role === 'admin' && !!c.socketId);
    const adminId = adm ? adm.clientId : null;
    if (typeof cb === 'function') cb({ adminId });
    else socket.emit('who_is_admin_resp', { adminId });
  });

  // rename: { clientId, newName }
  socket.on('rename', ({ clientId, newName }) => {
    if (!clientId || typeof newName !== 'string') return;
    clients[clientId] = clients[clientId] || { clientId };
    clients[clientId].name = newName;
    clients[clientId].lastSeen = Date.now();
    persistClients();
    broadcastClientsList();
    console.log(`[rename] ${clientId} => ${newName}`);
  });

  // start_talk: { from, target }
  socket.on('start_talk', ({ from, target }) => {
    if (!from) return;
    // broadcast speaking state to all clients so UI can highlight
    io.emit('speaking', { clientId: from, speaking: true, target: target || null });
    // create session so chunks add up
    ensureSession(from, target || 'UNKNOWN');
  });

  // stop_talk: { from, target }
  socket.on('stop_talk', ({ from, target }) => {
    if (!from) return;
    io.emit('speaking', { clientId: from, speaking: false, target: target || null });
    // finalize session summary (use same key used by ensureSession)
    endSessionAndEmitSummary(from, target || 'UNKNOWN');
  });

  // audio_chunk: payload { from, to, buffer }
  // 'to' can be a clientId (private), or 'ALL' (admin broadcast)
  socket.on('audio_chunk', (payload) => {
    try {
      if (!payload) return;
      const { from, to } = payload;
      const buffer = payload.buffer || payload; // sometimes raw binary sent directly
      if (!from) return;

      const byteLen = bufferByteLength(buffer);
      // update session bytes
      const sessionKey = `${from}::${to || 'UNKNOWN'}`;
      if (!activeSessions[sessionKey]) {
        // create session with start now if absent (helps if start_talk missed)
        activeSessions[sessionKey] = { from, to: to || 'UNKNOWN', startTs: Date.now(), bytes: 0 };
      }
      activeSessions[sessionKey].bytes = (activeSessions[sessionKey].bytes || 0) + byteLen;

      // Routing logic:
      // - If to === 'ALL' AND sender is admin -> broadcast to all users (excluding sender)
      // - Else if to is clientId -> forward only to that client's socket
      if (to === 'ALL' && clients[from] && clients[from].role === 'admin') {
        // send to all online users (role==='user') except the admin
        Object.values(clients).forEach(c => {
          if (c.role === 'user' && c.socketId && c.clientId !== from) {
            io.to(c.socketId).emit('audio_chunk', { from, buffer });
          }
        });
      } else if (to && clients[to] && clients[to].socketId) {
        // forward to target only
        io.to(clients[to].socketId).emit('audio_chunk', { from, buffer });
      } else {
        // target offline or unknown: if sender is user and admin online, forward to admin
        if (clients[from] && clients[from].role === 'user') {
          const adm = Object.values(clients).find(c => c.role === 'admin' && !!c.socketId);
          if (adm) {
            io.to(adm.socketId).emit('audio_chunk', { from, buffer });
          } // else drop
        } else {
          // nothing else to do
        }
      }
    } catch (e) {
      console.warn('audio_chunk error', e);
    }
  });

  socket.on('disconnect', (reason) => {
    const cid = socket.data.clientId;
    if (cid && clients[cid]) {
      clients[cid].socketId = null;
      clients[cid].lastSeen = Date.now();
      persistClients();
      broadcastClientsList();
      // if this client had active sessions, end them
      // find keys starting with `${cid}::` and end them
      Object.keys(activeSessions).forEach(k => {
        if (k.startsWith(`${cid}::`) || k.endsWith(`::${cid}`)) {
          const s = activeSessions[k];
          // emit speaking false for UI sync
          io.emit('speaking', { clientId: s.from, speaking: false, target: s.to });
          endSessionAndEmitSummary(s.from, s.to);
        }
      });
    }
    console.log('[disconnect]', socket.id, reason, cid || '');
  });

});

server.listen(PORT, () => {
  console.log(`Walkie server listening on port ${PORT}`);
});
