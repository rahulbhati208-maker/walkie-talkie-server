// server.js
// Signaling server for Walkie (matches your adminok.html and userok.html signalling)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 10000;

// client storage
// clients: clientId -> { socketId, clientId, name, role ('admin'|'user'), online, lastSeen }
const clients = {};

// helper find admin
function findAdmin() {
  for (const id in clients) {
    const c = clients[id];
    if (c.role === 'admin' && c.online) return c;
  }
  return null;
}

app.get('/', (req, res) => res.send('Walkie signaling server'));

// socket.io logic
io.on('connection', (socket) => {
  console.log('conn:', socket.id);

  // register: { clientId, role, name }
  socket.on('register', ({ clientId, role, name }) => {
    if (!clientId) clientId = 'c_' + Math.random().toString(36).slice(2,9);
    clients[clientId] = clients[clientId] || {};
    clients[clientId].socketId = socket.id;
    clients[clientId].clientId = clientId;
    clients[clientId].role = role || clients[clientId].role || 'user';
    clients[clientId].name = name || clients[clientId].name || clientId;
    clients[clientId].online = true;
    clients[clientId].lastSeen = Date.now();
    console.log('register', clientId, role, name);
    // ack
    socket.emit('registered', { clientId });
    // notify admin/admin UI if needed
    // broadcast clients list to all admins
    Object.values(clients).forEach(c => {
      if (c.role === 'admin' && c.socketId && c.socketId !== socket.id) {
        io.to(c.socketId).emit('clients_list', Object.values(clients).map(x => ({
          clientId: x.clientId, name: x.name, role: x.role, online: !!x.online
        })));
      }
    });
  });

  // request_clients -> return list of clients
  socket.on('request_clients', () => {
    const list = Object.values(clients).map(x => ({
      clientId: x.clientId, name: x.name, role: x.role, online: !!x.online
    }));
    socket.emit('clients_list', list);
  });

  // who_is_admin (callback style)
  socket.on('who_is_admin', (payload, cb) => {
    const adm = findAdmin();
    if (cb && typeof cb === 'function') {
      cb({ adminId: adm ? adm.clientId : null });
    } else {
      socket.emit('who_is_admin', { adminId: adm ? adm.clientId : null });
    }
  });

  // rename
  socket.on('rename', ({ clientId, newName }) => {
    if (clients[clientId]) {
      clients[clientId].name = newName;
      // notify admins of updated list
      Object.values(clients).forEach(c => {
        if (c.role === 'admin' && c.socketId) {
          io.to(c.socketId).emit('clients_list', Object.values(clients).map(x => ({
            clientId: x.clientId, name: x.name, role: x.role, online: !!x.online
          })));
        }
      });
    }
  });

  // generic chat_log - forward to admins and store to logs if you want (here just forward)
  socket.on('chat_log', (entry) => {
    // entry: { from, to, ts, bytes, duration }
    // send to admin(s) and to recipient if online
    if (!entry) return;
    // send to all admins
    Object.values(clients).forEach(c => {
      if (c.role === 'admin' && c.socketId) {
        io.to(c.socketId).emit('chat_log', entry);
      }
    });
    // forward to recipient if online
    if (entry.to && clients[entry.to] && clients[entry.to].socketId) {
      io.to(clients[entry.to].socketId).emit('chat_log', entry);
    }
  });

  // session_stats forwarding
  socket.on('session_stats', (stat) => {
    // forward to admin if present
    const adm = findAdmin();
    if (adm && adm.socketId) io.to(adm.socketId).emit('session_stats', stat);
  });

  // ---------- WebRTC signalling (events names used in your old files) ----------
  // webrtc_offer: { from, to, sdp }
  socket.on('webrtc_offer', ({ from, to, sdp }) => {
    if (!to) return;
    if (clients[to] && clients[to].socketId) {
      io.to(clients[to].socketId).emit('webrtc_offer', { from, sdp });
    } else {
      console.log('webrtc_offer -> target offline', to);
    }
  });

  // webrtc_answer: { from, to, sdp }
  socket.on('webrtc_answer', ({ from, to, sdp }) => {
    if (!to) return;
    if (clients[to] && clients[to].socketId) {
      io.to(clients[to].socketId).emit('webrtc_answer', { from, sdp });
    }
  });

  // webrtc_ice: { from, to, candidate }
  socket.on('webrtc_ice', ({ from, to, candidate }) => {
    if (!to) return;
    if (clients[to] && clients[to].socketId) {
      io.to(clients[to].socketId).emit('webrtc_ice', { from, candidate });
    }
  });

  // start_talk / stop_talk events -> broadcast speaking state
  // payload example { from: clientId, target: 'ALL' | 'admin' | userId }
  socket.on('start_talk', (payload) => {
    if (!payload) return;
    // forward to everyone so UIs update
    Object.values(clients).forEach(c => {
      if (c.socketId) io.to(c.socketId).emit('speaking', { clientId: payload.from, speaking: true, target: payload.target });
    });
  });
  socket.on('stop_talk', (payload) => {
    if (!payload) return;
    Object.values(clients).forEach(c => {
      if (c.socketId) io.to(c.socketId).emit('speaking', { clientId: payload.from, speaking: false, target: payload.target });
    });
  });

  // request to get a fresh clients list on demand
  socket.on('request_clients', () => {
    const list = Object.values(clients).map(x => ({
      clientId: x.clientId, name: x.name, role: x.role, online: !!x.online
    }));
    socket.emit('clients_list', list);
  });

  // disconnect handling
  socket.on('disconnect', () => {
    // mark any client with this socket as offline
    for (const id in clients) {
      if (clients[id].socketId === socket.id) {
        clients[id].online = false;
        clients[id].lastSeen = Date.now();
        console.log('client offline', id, clients[id].role);
        // notify admins
        Object.values(clients).forEach(c => {
          if (c.role === 'admin' && c.socketId) {
            io.to(c.socketId).emit('clients_list', Object.values(clients).map(x => ({
              clientId: x.clientId, name: x.name, role: x.role, online: !!x.online
            })));
          }
        });
      }
    }
  });

});

server.listen(PORT, () => console.log('Signaling server running on port', PORT));
