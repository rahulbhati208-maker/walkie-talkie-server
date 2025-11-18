const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// Stores socketId -> { role, adminId (if user) }
let clients = {};
// Stores password -> admin socketId
let adminPasswords = {};

io.on("connection", socket => {
  console.log("Connected:", socket.id);

  // Register role
  socket.on("register", role => {
    if (role === "admin") {
      // Generate a 4-digit password
      const password = Math.floor(1000 + Math.random() * 9000).toString();
      adminPasswords[password] = socket.id;
      clients[socket.id] = { role: "admin", password, users: {} };
      socket.emit("your-password", password);
      console.log(`Admin ${socket.id} password: ${password}`);
    }
    if (role === "user") {
      clients[socket.id] = { role: "user", adminId: null };
    }
  });

  // User joins using admin password
  socket.on("join-admin", password => {
    const adminId = adminPasswords[password];
    if (!adminId) {
      socket.emit("invalid-password");
      return;
    }

    clients[socket.id].adminId = adminId;
    // Add this user to admin's users
    clients[adminId].users[socket.id] = true;

    // Notify user and admin
    socket.emit("connected-to-admin", adminId);
    io.to(adminId).emit("user-list", Object.keys(clients[adminId].users));
    console.log(`User ${socket.id} connected to admin ${adminId}`);
  });

  // Signaling relay
  socket.on("signal", ({ targetId, data }) => {
    if (targetId) io.to(targetId).emit("signal", { id: socket.id, data });
  });

  // Disconnect handling
  socket.on("disconnect", () => {
    const client = clients[socket.id];
    if (!client) return;

    if (client.role === "user" && client.adminId) {
      const adminId = client.adminId;
      if (clients[adminId]) {
        delete clients[adminId].users[socket.id];
        io.to(adminId).emit("user-list", Object.keys(clients[adminId].users));
      }
    }

    if (client.role === "admin") {
      // Remove password mapping
      delete adminPasswords[client.password];
      // Notify connected users
      Object.keys(client.users).forEach(uid => {
        io.to(uid).emit("admin-disconnected");
      });
    }

    delete clients[socket.id];
    console.log("Disconnected:", socket.id);
  });
});

server.listen(PORT, () => console.log("Server running on port", PORT));
