/**
 * server.js
 * Walkie-talkie signaling + presence server using Socket.IO
 *
 * - WebRTC signaling: webrtc_offer, webrtc_answer, webrtc_ice (forwarded to target)
 * - Presence: register, request_clients, who_is_admin, rename
 * - Speaking/session lifecycle: start_talk, stop_talk -> aggregated chat_log entries
 * - Private mode: audio is P2P between admin and users (admin <-> user)
 *
 * Usage: node server.js
 */

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

// Serve frontend if present
const FRONT = path.join(__dirname, 'frontend');
if (fs.existsSync(FRONT)) {
  app.use(express.static(FRONT));
  console.log('Serving frontend from', FRONT);
}

// Load persisted clients (names)
let clients = {}; // clientId -> { clientId, name, role, socketId, lastSeen }
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8') || '{}';
    clients = JSON.parse(raw);
  }
} catch (e) {
  console.warn('clients.json load failed', e);
  clients = {};
}

function persistClients() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(clients, null, 2));
  } catch (e) {
    console.warn('persist write failed', e);
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

/* Active session tracking (used for aggregated chat_log)
   key = `${from}::${to}` where to may be clientId or 'ALL' or 'UNKNOWN'
   value = { from, to, startTs, bytes }
*/
const activeSessions = {};

function sessionKey(from, to) {
  return `${from}::${to || 'UNKNOWN'}`;
}

function ensureSession(from, to) {
  const k = sessionKey(from, to);
  if (!activeSessions[k]) activeSessions[k] = { from, to, startTs: Date.now(), bytes: 0 };
  return activeSessions[k];
}

function endSessionAndEmitSummary(from, to) {
  const k = sessionKey(from, to);
  const s = activeSessions[k];
  if (!s) return;
  const duration = Math.round((Date.now() - s.startTs) / 1000);
  const entry = { from: s.from, to: s.to, ts: Date.now(), duration, bytes: s.bytes || 0 };
  // emit to all (admin UI displays on right/left panes)
  io.emit('chat_log', entry);
  delete activeSessions[k];
}

// Helper to compute byte length for Buffer / ArrayBuffer / Blob-like shapes
function bufferByteLength(buf) {
  if (!buf) return 0;
  if (Buffer.isBuffer(buf)) return buf.length;
  if (buf instanceof ArrayBuffer) return buf.byteLength;
  if (buf && buf.byteLength !== undefined) return buf.byteLength;
  if (buf && buf.data && Array.isArray(buf.data)) return buf.data.length;
  if (buf.size !== undefined) return buf.size;
  return 0;
}

/* ------------------ Socket.IO handlers ------------------ */
io.on('connection', (socket) => {
  console.log('[connect]', socket.id);

  // Register the client
  // payload: { clientId, role, name }
  socket.on('register', (payload = {}) => {
    const { clientId, role = 'user', name } = payload;
    if (!clientId) {
      socket.emit('register_ack', { ok: false, error: 'clientId required' });
      return;
    }
    clients[clientId] = clients[clientId] || { clientId };
    clients[clientId].socketId = socket.id;
    clients[clientId].role = role;
    if (typeof name === 'string' && name.trim().length > 0) clients[clientId].name = name.trim();
    clients[clientId].lastSeen = Date.now();
    socket.data.clientId = clientId;
    socket.data.role = role;
    persistClients();
    socket.emit('register_ack', { ok: true });
    broadcastClientsList();
    console.log(`[register] ${clientId} (${role}) ${clients[clientId].name || ''}`);
  });

  // Request clients list
  socket.on('request_clients', () => {
    socket.emit('clients_list', buildClientsList());
  });

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

  /* ---------------- WebRTC signalling ----------------
     The frontend should send:
       webrtc_offer: { from, to, sdp }
       webrtc_answer: { from, to, sdp }
       webrtc_ice: { from, to, candidate }
     Server simply forwards to the socketId of 'to' if online
  ----------------------------------------------------*/
  socket.on('webrtc_offer', (payload) => {
    try {
      const { from, to, sdp } = payload || {};
      if (!from || !to) return;
      const target = clients[to];
      if (target && target.socketId) {
        io.to(target.socketId).emit('webrtc_offer', { from, sdp });
      } else {
        // target offline, optionally notify sender
        socket.emit('webrtc_no_target', { to });
      }
    } catch (e) { console.warn('webrtc_offer error', e); }
  });

  socket.on('webrtc_answer', (payload) => {
    try {
      const { from, to, sdp } = payload || {};
      if (!from || !to) return;
      const target = clients[to];
      if (target && target.socketId) {
        io.to(target.socketId).emit('webrtc_answer', { from, sdp });
      }
    } catch (e) { console.warn('webrtc_answer error', e); }
  });

  socket.on('webrtc_ice', (payload) => {
    try {
      const { from, to, candidate } = payload || {};
      if (!from || !to) return;
      const target = clients[to];
      if (target && target.socketId) {
        io.to(target.socketId).emit('webrtc_ice', { from, candidate });
      }
    } catch (e) { console.warn('webrtc_ice error', e); }
  });

  /* ---------------- Session / speaking lifecycle ----------------
     start_talk: { from, target }  // create session and broadcast speaking state
     stop_talk:  { from, target }  // end session, emit summarized chat_log
  --------------------------------------------------------------*/
  socket.on('start_talk', ({ from, target }) => {
    if (!from) return;
    // ensure session exists
    ensureSession(from, target || 'UNKNOWN');
    // broadcast speaking -> clients can highlight UI (admin -> target or user -> admin)
    io.emit('speaking', { clientId: from, speaking: true, target: target || null });
  });

  socket.on('stop_talk', ({ from, target }) => {
    if (!from) return;
    io.emit('speaking', { clientId: from, speaking: false, target: target || null });
    // finalize session summary and emit chat_log
    endSessionAndEmitSummary(from, target || 'UNKNOWN');
  });

  /* For legacy/frontends that forward binary chunks via sockets (we still support it):
     audio_chunk: { from, to, buffer }  // server will forward similarly as before and accumulate bytes
     NOTE: With WebRTC you won't use audio_chunk for media, but you might use it for fallback.
  */
  socket.on('audio_chunk', (payload) => {
    try {
      if (!payload) return;
      const { from, to } = payload;
      const buffer = payload.buffer || payload; // sometimes raw binary
      const bytes = bufferByteLength(buffer);
      // accumulate into session
      const sess = ensureSession(from, to || 'UNKNOWN');
      sess.bytes = (sess.bytes || 0) + bytes;

      // routing: if to==='ALL' and from is admin -> forward to all users
      if (to === 'ALL' && clients[from] && clients[from].role === 'admin') {
        Object.values(clients).forEach(c => {
          if (c.role === 'user' && c.socketId && c.clientId !== from) {
            io.to(c.socketId).emit('audio_chunk', { from, buffer });
          }
        });
        return;
      }

      // direct forward if target online
      if (to && clients[to] && clients[to].socketId) {
        io.to(clients[to].socketId).emit('audio_chunk', { from, buffer });
      } else {
        // fallback: if sender is user, forward to admin (if online)
        if (clients[from] && clients[from].role === 'user') {
          const admin = Object.values(clients).find(c => c.role === 'admin' && !!c.socketId);
          if (admin) io.to(admin.socketId).emit('audio_chunk', { from, buffer });
        }
      }
    } catch (e) {
      console.warn('audio_chunk error', e);
    }
  });

  /* Cleanup on disconnect */
  socket.on('disconnect', (reason) => {
    const cid = socket.data.clientId;
    console.log('[disconnect]', socket.id, cid || '', reason);
    if (cid && clients[cid]) {
      clients[cid].socketId = null;
      clients[cid].lastSeen = Date.now();
      persistClients();
      broadcastClientsList();

      // finalize any active sessions involving this client
      Object.keys(activeSessions).forEach(k => {
        if (k.startsWith(`${cid}::`) || k.endsWith(`::${cid}`)) {
          const s = activeSessions[k];
          // notify UI that speaking stopped for this client
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
