// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ====== DATA STRUCTURES ======
let adminPasswords = {}; // password -> admin socket id
let userToAdmin = {};    // user socket id -> admin socket id
let adminUsers = {};     // admin socket id -> [user socket ids]

// ====== SOCKET CONNECTION ======
io.on("connection", socket => {
  console.log("Connected:", socket.id);

  // ===== REGISTER ROLE =====
  socket.on("register", role => {
    if(role==="admin"){
      // Generate 4-digit password
      const password = Math.floor(1000 + Math.random() * 9000).toString();
      adminPasswords[password] = socket.id;
      adminUsers[socket.id] = [];

      // Emit password to admin
      process.nextTick(() => {
        socket.emit("your-password", password);
      });

      console.log(`Admin connected: ${socket.id}, password: ${password}`);
    }
  });

  // ===== USER JOINS ADMIN =====
  socket.on("join-admin", password => {
    const adminId = adminPasswords[password];
    if(!adminId){
      socket.emit("invalid-password");
      return;
    }

    userToAdmin[socket.id] = adminId;
    adminUsers[adminId].push(socket.id);

    socket.emit("connected-to-admin");
    io.to(adminId).emit("user-list", adminUsers[adminId]);
    console.log(`User ${socket.id} joined admin ${adminId}`);
  });

  // ===== SIGNALING =====
  socket.on("signal", ({targetId, data}) => {
    io.to(targetId).emit("signal", {id: socket.id, data});
  });

  // ===== DISCONNECT =====
  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    // Remove user from admin
    if(userToAdmin[socket.id]){
      const adminId = userToAdmin[socket.id];
      adminUsers[adminId] = adminUsers[adminId].filter(u => u !== socket.id);
      io.to(adminId).emit("user-list", adminUsers[adminId]);
      delete userToAdmin[socket.id];
    }

    // Remove admin and notify users
    Object.keys(adminPasswords).forEach(p => {
      if(adminPasswords[p] === socket.id){
        adminUsers[socket.id]?.forEach(u => io.to(u).emit("admin-disconnected"));
        delete adminUsers[socket.id];
        delete adminPasswords[p];
      }
    });
  });
});

// ====== START SERVER ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
