const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 10000;

// Data stores
const admins = {};      // code: {socket, users:{}}
const users = {};       // socketId: {name, adminCode, socket}

app.use(express.static("public"));

// Helper to generate 4-digit code
function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("register-admin", () => {
    const code = generateCode();
    admins[code] = { socket, users:{} };
    socket.emit("admin-registered", code);
    console.log("Admin registered with code:", code);

    socket.on("disconnect", () => {
      console.log("Admin disconnected:", code);
      Object.values(admins[code].users).forEach(u => {
        u.socket.emit("admin-offline");
      });
      delete admins[code];
    });

    socket.on("offer", ({target, sdp}) => {
      if(admins[code].users[target])
        admins[code].users[target].socket.emit("offer", {from: socket.id, sdp});
    });

    socket.on("answer", ({target, sdp}) => {
      io.to(target).emit("answer", {from: socket.id, sdp});
    });

    socket.on("ice-candidate", ({target, candidate}) => {
      io.to(target).emit("ice-candidate", {from: socket.id, candidate});
    });

    socket.on("broadcast-toggle", (enabled) => {
      Object.values(admins[code].users).forEach(u=>{
        u.socket.emit("admin-broadcast",{enabled});
      });
    });
  });

  socket.on("register-user", ({name, adminCode}) => {
    if(!admins[adminCode]){
      socket.emit("admin-offline");
      return;
    }
    users[socket.id] = { name, adminCode, socket };
    admins[adminCode].users[socket.id] = users[socket.id];
    socket.emit("admin-online");
    admins[adminCode].socket.emit("user-joined",{id: socket.id, name});

    socket.on("disconnect", () => {
      if(users[socket.id]){
        admins[adminCode].socket.emit("user-left",{id: socket.id});
        delete admins[adminCode].users[socket.id];
        delete users[socket.id];
      }
    });

    socket.on("offer", ({sdp}) => {
      admins[adminCode].socket.emit("offer",{from: socket.id, sdp});
    });

    socket.on("answer", ({sdp}) => {
      const adminSocket = admins[adminCode]?.socket;
      if(adminSocket) adminSocket.emit("answer",{from: socket.id, sdp});
    });

    socket.on("ice-candidate", ({candidate}) => {
      const adminSocket = admins[adminCode]?.socket;
      if(adminSocket) adminSocket.emit("ice-candidate",{from: socket.id, candidate});
    });
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
