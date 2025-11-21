// SUPER SIMPLE WALKIE TALKIE SERVER (NO WEBRTC)
// Audio is transmitted via Socket.IO chunks

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

// Serve frontend if present
app.use(express.static(path.join(__dirname, "frontend")));

let clients = {};  // clientId → { name, role, socketId }
let currentSpeaker = null; // only 1 person can speak at a time

function broadcastUserList() {
  const list = Object.keys(clients).map(id => ({
    clientId: id,
    name: clients[id].name,
    role: clients[id].role,
    online: clients[id].socketId ? true : false
  }));
  io.emit("clients_list", list);
}

io.on("connection", socket => {
  console.log("CONNECTED:", socket.id);

  socket.on("register", ({ clientId, role, name }) => {
    if (!clientId) return;
    clients[clientId] = clients[clientId] || {};
    clients[clientId].socketId = socket.id;
    clients[clientId].role = role || "user";
    clients[clientId].name = name || clients[clientId].name || "Unnamed";

    socket.data.clientId = clientId;

    socket.emit("register_ack", { ok: true });
    broadcastUserList();

    console.log("REGISTER:", clientId, clients[clientId]);
  });

  // Rename (admin or user)
  socket.on("rename", ({ clientId, newName }) => {
    if (!clients[clientId]) return;
    clients[clientId].name = newName;
    broadcastUserList();
  });

  // SPEAK REQUEST
  socket.on("start_speaking", ({ clientId }) => {
    if (!clientId) return;

    // check busy
    if (currentSpeaker && currentSpeaker !== clientId) {
      socket.emit("speak_denied", { reason: "busy", currentSpeaker });
      return;
    }

    currentSpeaker = clientId;
    io.emit("speaking", { clientId, speaking: true });
  });

  socket.on("stop_speaking", ({ clientId }) => {
    if (currentSpeaker === clientId) {
      currentSpeaker = null;
      io.emit("speaking", { clientId, speaking: false });
    }
  });

  // AUDIO CHUNKS
  socket.on("audio_chunk", ({ to, from, buffer }) => {
    const target = clients[to];
    if (target && target.socketId) {
      io.to(target.socketId).emit("audio_chunk", { from, buffer });
    }
  });

  socket.on("disconnect", () => {
    const clientId = socket.data.clientId;
    if (clientId && clients[clientId]) {
      clients[clientId].socketId = null;

      if (currentSpeaker === clientId) {
        currentSpeaker = null;
        io.emit("speaking", { clientId, speaking: false });
      }

      broadcastUserList();
    }

    console.log("DISCONNECTED:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log("Walkie Talkie Server running on port", PORT);
});
