// server.js — Walkie Talkie Signaling (no local SSL; Render handles HTTPS)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000;
const DATA_FILE = path.join(__dirname, 'clients.json');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e7 });

// persistent clients
let clients = {};
try {
  if (fs.existsSync(DATA_FILE)) clients = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
} catch (e) { clients = {}; }

function persist() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(clients, null, 2)); } catch(e){ /* ignore */ }
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
function broadcastClients() { io.emit('clients_list', buildClientsList()); }

/* sessions aggregation for logs */
const activeSessions = {}; // key: from::to -> { from, to, startTs, bytes }

function skey(from,to){ return `${from}::${to||'UNKNOWN'}`; }
function ensureSession(from,to){
  const k = skey(from,to);
  if(!activeSessions[k]) activeSessions[k] = { from, to: to||'UNKNOWN', startTs: Date.now(), bytes: 0 };
  return activeSessions[k];
}
function addBytes(from,to,bytes){
  const k = skey(from,to);
  ensureSession(from,to);
  activeSessions[k].bytes = (activeSessions[k].bytes || 0) + (Number(bytes) || 0);
}
function endSession(from,to){
  const k = skey(from,to);
  const s = activeSessions[k];
  if(!s) return;
  const entry = { from: s.from, to: s.to, ts: Date.now(), duration: Math.round((Date.now()-s.startTs)/1000), bytes: s.bytes || 0 };
  io.emit('chat_log', entry);
  delete activeSessions[k];
}

/* helper to forward signaling to a client */
function forwardToClient(ev, payload){
  if(!payload || !payload.to) return;
  const target = clients[payload.to];
  if(target && target.socketId) io.to(target.socketId).emit(ev, payload);
}

io.on('connection', (socket) => {
  // console.log('connect', socket.id);

  socket.on('register', (payload={}) => {
    const { clientId, role='user', name } = payload;
    if(!clientId) { socket.emit('register_ack', { ok:false, error:'clientId required' }); return; }
    clients[clientId] = clients[clientId] || { clientId };
    clients[clientId].socketId = socket.id;
    clients[clientId].role = role;
    if(name) clients[clientId].name = name;
    clients[clientId].lastSeen = Date.now();
    socket.data.clientId = clientId;
    socket.data.role = role;
    persist();
    socket.emit('register_ack', { ok:true });
    broadcastClients();
  });

  socket.on('request_clients', () => socket.emit('clients_list', buildClientsList()));

  socket.on('who_is_admin', (p, cb) => {
    const adm = Object.values(clients).find(x => x.role === 'admin' && !!x.socketId);
    const adminId = adm ? adm.clientId : null;
    if(typeof cb === 'function') cb({ adminId }); else socket.emit('who_is_admin_resp', { adminId });
  });

  socket.on('rename', ({ clientId, newName }) => {
    if(!clientId || typeof newName !== 'string') return;
    clients[clientId] = clients[clientId] || { clientId };
    clients[clientId].name = newName.trim();
    clients[clientId].lastSeen = Date.now();
    persist();
    broadcastClients();
  });

  /* Signaling relay */
  socket.on('webrtc_offer', (d) => forwardToClient('webrtc_offer', d));
  socket.on('webrtc_answer', (d) => forwardToClient('webrtc_answer', d));
  socket.on('webrtc_ice', (d) => forwardToClient('webrtc_ice', d));

  /* start/stop talk lifecycle */
  socket.on('start_talk', ({ from, target }) => {
    if(!from) return;
    ensureSession(from, target || 'UNKNOWN');
    io.emit('speaking', { clientId: from, speaking: true, target: target || null });
  });
  socket.on('stop_talk', ({ from, target }) => {
    if(!from) return;
    io.emit('speaking', { clientId: from, speaking: false, target: target || null });
    endSession(from, target || 'UNKNOWN');
  });

  /* session stats aggregator */
  socket.on('session_stats', ({ from, to, bytesSent, bytesReceived, bytes }) => {
    // support different field names
    const bytesVal = Number(bytesSent || bytesReceived || bytes || 0);
    if(!from) return;
    addBytes(from, to || 'UNKNOWN', bytesVal);
  });

  /* legacy audio chunk forwarding (if any) */
  socket.on('audio_chunk', (payload) => {
    try {
      if(!payload) return;
      const { from, to, buffer } = payload;
      const size = buffer ? (buffer.length || buffer.byteLength || 0) : 0;
      addBytes(from, to || 'UNKNOWN', size);
      if(to === 'ALL'){
        Object.values(clients).forEach(c => {
          if(c.role !== 'admin' && c.socketId && c.clientId !== from) io.to(c.socketId).emit('audio_chunk', { from, buffer });
        });
      } else {
        const tgt = clients[to];
        if(tgt && tgt.socketId) io.to(tgt.socketId).emit('audio_chunk', { from, buffer });
      }
    } catch(e){ /* ignore */ }
  });

  socket.on('disconnect', () => {
    const cid = socket.data.clientId;
    if(cid && clients[cid]) {
      clients[cid].socketId = null;
      clients[cid].lastSeen = Date.now();
      persist();
      broadcastClients();
      // finalize any active sessions related to this client
      Object.keys(activeSessions).forEach(k => {
        if(k.startsWith(`${cid}::`) || k.endsWith(`::${cid}`)) {
          const s = activeSessions[k];
          io.emit('speaking', { clientId: s.from, speaking: false, target: s.to });
          endSession(s.from, s.to);
        }
      });
    }
  });
});

server.listen(PORT, () => {
  console.log('Signaling server listening on port', PORT);
});
