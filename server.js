// server.js
// Walkie-talkie signaling + presence server with WebRTC support and session stats aggregation
// Node >= 18 recommended

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'clients.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 5e7
});

// Serve frontend if present (optional)
const FRONT = path.join(__dirname, 'frontend');
if (fs.existsSync(FRONT)) {
  app.use(express.static(FRONT));
  console.log('Serving frontend from', FRONT);
}

// Persistent client metadata (names)
let clients = {}; // clientId -> { clientId, name, role, socketId, lastSeen }
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8') || '{}';
    clients = JSON.parse(raw);
  }
} catch (e) {
  console.warn('Failed to load clients.json', e);
  clients = {};
}
function persistClients() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(clients, null, 2)); }
  catch (e) { console.warn('persist error', e); }
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
function broadcastClientsList() { io.emit('clients_list', buildClientsList()); }

// Active sessions tracking for aggregation
// key: `${from}::${to}`
const activeSessions = {};

function sessionKey(from, to) {
  return `${from}::${to || 'UNKNOWN'}`;
}
function ensureSession(from, to) {
  const k = sessionKey(from, to);
  if (!activeSessions[k]) activeSessions[k] = { from, to, startTs: Date.now(), bytes: 0 };
  return activeSessions[k];
}
function addBytesToSession(from, to, bytes) {
  const k = sessionKey(from, to);
  if (!activeSessions[k]) activeSessions[k] = { from, to, startTs: Date.now(), bytes: 0 };
  activeSessions[k].bytes = (activeSessions[k].bytes || 0) + (Number(bytes) || 0);
  return activeSessions[k].bytes;
}
function endSessionAndEmitSummary(from, to) {
  const k = sessionKey(from, to);
  const s = activeSessions[k];
  if (!s) return;
  const duration = Math.round((Date.now() - s.startTs)/1000);
  const entry = { from: s.from, to: s.to, ts: Date.now(), duration, bytes: s.bytes || 0 };
  io.emit('chat_log', entry);
  delete activeSessions[k];
}

// helper: byte length for raw binary payloads (legacy audio_chunk support)
function bufferByteLength(buf) {
  if (!buf) return 0;
  if (Buffer.isBuffer(buf)) return buf.length;
  if (buf instanceof ArrayBuffer) return buf.byteLength;
  if (buf && buf.byteLength !== undefined) return buf.byteLength;
  if (buf && buf.data && Array.isArray(buf.data)) return buf.data.length;
  if (buf && buf.size !== undefined) return buf.size;
  return 0;
}

io.on('connection', (socket) => {
  console.log('[connect]', socket.id);

  // REGISTER
  socket.on('register', (payload = {}) => {
    const { clientId, role = 'user', name } = payload;
    if (!clientId) { socket.emit('register_ack', { ok:false, error:'clientId required' }); return; }
    clients[clientId] = clients[clientId] || { clientId };
    clients[clientId].socketId = socket.id;
    clients[clientId].role = role;
    if (typeof name === 'string' && name.trim().length) clients[clientId].name = name.trim();
    clients[clientId].lastSeen = Date.now();
    socket.data.clientId = clientId;
    socket.data.role = role;
    persistClients();
    socket.emit('register_ack', { ok:true });
    broadcastClientsList();
    console.log(`[register] ${clientId} (${role}) ${clients[clientId].name || ''}`);
  });

  // request_clients
  socket.on('request_clients', () => socket.emit('clients_list', buildClientsList()));

  // who_is_admin (callback)
  socket.on('who_is_admin', (payload, cb) => {
    const adm = Object.values(clients).find(c => c.role === 'admin' && !!c.socketId);
    const adminId = adm ? adm.clientId : null;
    if (typeof cb === 'function') cb({ adminId });
    else socket.emit('who_is_admin_resp', { adminId });
  });

  // rename
  socket.on('rename', ({ clientId, newName }) => {
    if (!clientId || typeof newName !== 'string') return;
    clients[clientId] = clients[clientId] || { clientId };
    clients[clientId].name = newName.trim();
    clients[clientId].lastSeen = Date.now();
    persistClients();
    broadcastClientsList();
    console.log(`[rename] ${clientId} => ${newName}`);
  });

  /* ---------------- WebRTC signaling forwarding ---------------- */
  socket.on('webrtc_offer', (payload) => {
    try {
      const { from, to, sdp } = payload || {};
      if (!from || !to) return;
      const target = clients[to];
      if (target && target.socketId) {
        io.to(target.socketId).emit('webrtc_offer', { from, sdp });
      } else {
        socket.emit('webrtc_no_target', { to });
      }
    } catch (e) { console.warn('webrtc_offer error', e); }
  });

  socket.on('webrtc_answer', (payload) => {
    try {
      const { from, to, sdp } = payload || {};
      if (!from || !to) return;
      const target = clients[to];
      if (target && target.socketId) io.to(target.socketId).emit('webrtc_answer', { from, sdp });
    } catch (e) { console.warn('webrtc_answer error', e); }
  });

  socket.on('webrtc_ice', (payload) => {
    try {
      const { from, to, candidate } = payload || {};
      if (!from || !to) return;
      const target = clients[to];
      if (target && target.socketId) io.to(target.socketId).emit('webrtc_ice', { from, candidate });
    } catch (e) { console.warn('webrtc_ice error', e); }
  });

  /* ---------------- Session lifecycle ---------------- */
  socket.on('start_talk', ({ from, target }) => {
    if (!from) return;
    ensureSession(from, target || 'UNKNOWN');
    io.emit('speaking', { clientId: from, speaking: true, target: target || null });
  });

  socket.on('stop_talk', ({ from, target }) => {
    if (!from) return;
    io.emit('speaking', { clientId: from, speaking: false, target: target || null });
    endSessionAndEmitSummary(from, target || 'UNKNOWN');
  });

  /* Clients can send stats (from RTCPeerConnection.getStats) after/while session runs:
     session_stats: { from, to, bytesSent, bytesReceived }  -> we aggregate bytes
     This helps avoid '0B' in logs when media goes over WebRTC.
  */
  socket.on('session_stats', ({ from, to, bytesSent, bytesReceived }) => {
    try {
      if (!from) return;
      const bytes = Number(bytesSent || bytesReceived || 0);
      if (bytes > 0) addBytesToSession(from, to || 'UNKNOWN', bytes);
    } catch (e) { console.warn('session_stats err', e); }
  });

  /* legacy support: audio_chunk forwarding if someone still sends binary chunks */
  socket.on('audio_chunk', (payload) => {
    try {
      if (!payload) return;
      const { from, to } = payload;
      const buffer = payload.buffer || payload;
      const bytes = bufferByteLength(buffer);
      addBytesToSession(from, to || 'UNKNOWN', bytes);

      if (to === 'ALL' && clients[from] && clients[from].role === 'admin') {
        Object.values(clients).forEach(c => {
          if (c.role === 'user' && c.socketId && c.clientId !== from) {
            io.to(c.socketId).emit('audio_chunk', { from, buffer });
          }
        });
        return;
      }

      if (to && clients[to] && clients[to].socketId) {
        io.to(clients[to].socketId).emit('audio_chunk', { from, buffer });
      } else {
        if (clients[from] && clients[from].role === 'user') {
          const adm = Object.values(clients).find(c => c.role === 'admin' && !!c.socketId);
          if (adm) io.to(adm.socketId).emit('audio_chunk', { from, buffer });
        }
      }
    } catch (e) { console.warn('audio_chunk error', e); }
  });

  /* Disconnect cleanup */
  socket.on('disconnect', (reason) => {
    const cid = socket.data.clientId;
    console.log('[disconnect]', socket.id, cid || '', reason);
    if (cid && clients[cid]) {
      clients[cid].socketId = null;
      clients[cid].lastSeen = Date.now();
      persistClients();
      broadcastClientsList();

      // finalize active sessions involving this client
      Object.keys(activeSessions).forEach(k => {
        if (k.startsWith(`${cid}::`) || k.endsWith(`::${cid}`)) {
          const s = activeSessions[k];
          io.emit('speaking', { clientId: s.from, speaking: false, target: s.to });
          endSessionAndEmitSummary(s.from, s.to);
        }
      });
    }
  });

}); // io.on('connection')

/* Start server */
server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
