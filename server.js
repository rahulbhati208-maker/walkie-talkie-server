// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Data
let adminSockets = new Set();
let userSockets = new Set();
let userToAdmin = {}; // userId -> adminId

io.on("connection", socket => {
  console.log("Connected:", socket.id);

  // Role register
  socket.on("register", role => {
    if(role==="admin"){
      adminSockets.add(socket.id);
      socket.emit("role", "admin");
      io.emit("update-users", Array.from(userSockets));
    } else {
      userSockets.add(socket.id);
      socket.emit("role", "user");
      // Assign first admin available
      const adminId = Array.from(adminSockets)[0];
      if(adminId) userToAdmin[socket.id] = adminId;
      io.to(adminId).emit("update-users", Array.from(userSockets));
    }
  });

  // WebRTC signaling
  socket.on("signal", ({targetId, data}) => {
    io.to(targetId).emit("signal", {id: socket.id, data});
  });

  socket.on("disconnect", () => {
    adminSockets.delete(socket.id);
    userSockets.delete(socket.id);
    Object.keys(userToAdmin).forEach(u => { if(userToAdmin[u]===socket.id) delete userToAdmin[u]; });
    io.emit("update-users", Array.from(userSockets));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
