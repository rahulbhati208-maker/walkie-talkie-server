// FULL DUPLEX WALKIE-TALKIE SERVER (Android + iOS working)
// No TURN, no WebRTC. Pure socket.io audio streaming.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// For optional static delivery
app.use(express.static(path.join(__dirname, "frontend")));

let clients = {};  // clientId -> { name, role, socketId }
let adminBroadcast = false; // broadcast ON/OFF

function broadcastUserList() {
  const list = Object.keys(clients).map(id => ({
    clientId: id,
    name: clients[id].name,
    role: clients[id].role,
    online: Boolean(clients[id].socketId)
  }));
  io.emit("clients_list", list);
}

io.on("connection", socket => {
  console.log("CONNECTED:", socket.id);

  // Register user or admin
  socket.on("register", ({ clientId, role, name }) => {
    if (!clientId) return;
    clients[clientId] = clients[clientId] || {};
    clients[clientId].socketId = socket.id;
    clients[clientId].role = role || "user";
    clients[clientId].name = name || clients[clientId].name || "Unnamed";

    socket.data.clientId = clientId;
    socket.emit("register_ack", { ok: true });

    broadcastUserList();
  });

  // Rename realtime
  socket.on("rename", ({ clientId, newName }) => {
    if (!clients[clientId]) return;
    clients[clientId].name = newName;
    broadcastUserList();
  });

  // FULL DUPLEX TALK START
  socket.on("start_talk", ({ from, target }) => {
    io.emit("talking", { from, target, status: true });
  });

  // FULL DUPLEX TALK STOP
  socket.on("stop_talk", ({ from, target }) => {
    io.emit("talking", { from, target, status: false });
  });

  // ADMIN BROADCAST MODE
  socket.on("admin_broadcast_toggle", ({ adminId }) => {
    adminBroadcast = !adminBroadcast;
    io.emit("admin_broadcast_status", { enabled: adminBroadcast });
  });

  // AUDIO CHUNKS
  socket.on("audio_chunk", ({ from, to, buffer }) => {
    if (adminBroadcast && from === "admin") {
      // Send to ALL online users
      for (let u in clients) {
        if (clients[u].socketId && clients[u].role === "user") {
          io.to(clients[u].socketId).emit("audio_chunk", { from, buffer });
        }
      }
      return;
    }

    // Full duplex: send audio to the OTHER side
    if (clients[to] && clients[to].socketId) {
      io.to(clients[to].socketId).emit("audio_chunk", { from, buffer });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    const id = socket.data.clientId;
    if (id && clients[id]) {
      clients[id].socketId = null;
    }
    broadcastUserList();
  });
});

server.listen(PORT, () => {
  console.log("Server running on PORT", PORT);
});
