const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static("public"));

const admins = {}; // adminCode => { socketId, users: {} }
const users = {}; // socketId => { name, adminCode, speaking }

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Admin registration
  socket.on("register-admin", () => {
    const adminCode = uuidv4().slice(0, 6);
    admins[adminCode] = { socketId: socket.id, users: {} };
    socket.emit("admin-registered", adminCode);
    console.log("Admin registered:", adminCode);
  });

  // User registration with admin code
  socket.on("register-user", ({ name, adminCode }) => {
    if (!admins[adminCode]) {
      socket.emit("invalid-admin-code");
      return;
    }
    users[socket.id] = { name, adminCode, speaking: false };
    admins[adminCode].users[socket.id] = users[socket.id];
    // Notify admin
    io.to(admins[adminCode].socketId).emit(
      "user-joined",
      { id: socket.id, name }
    );
    console.log(`${name} joined admin ${adminCode}`);
  });

  // User talks
  socket.on("user-start-talk", () => {
    const user = users[socket.id];
    if (!user) return;
    user.speaking = true;
    const adminSocket = admins[user.adminCode].socketId;
    io.to(adminSocket).emit("user-speaking", { id: socket.id, name: user.name, speaking: true });
  });

  socket.on("user-stop-talk", () => {
    const user = users[socket.id];
    if (!user) return;
    user.speaking = false;
    const adminSocket = admins[user.adminCode].socketId;
    io.to(adminSocket).emit("user-speaking", { id: socket.id, name: user.name, speaking: false });
  });

  // User name change
  socket.on("change-user-name", (newName) => {
    const user = users[socket.id];
    if (!user) return;
    const oldName = user.name;
    user.name = newName;
    const adminSocket = admins[user.adminCode].socketId;
    io.to(adminSocket).emit("user-name-changed", { id: socket.id, oldName, newName });
    socket.emit("user-name-updated", newName);
  });

  // Disconnect
  socket.on("disconnect", () => {
    // Remove user
    if (users[socket.id]) {
      const { name, adminCode } = users[socket.id];
      if (admins[adminCode]) {
        delete admins[adminCode].users[socket.id];
        io.to(admins[adminCode].socketId).emit("user-left", { id: socket.id, name });
      }
      delete users[socket.id];
      console.log(`${name} disconnected`);
    }
    // Remove admin
    for (const code in admins) {
      if (admins[code].socketId === socket.id) {
        const allUsers = admins[code].users;
        Object.keys(allUsers).forEach(uId => {
          delete users[uId];
        });
        delete admins[code];
        console.log(`Admin ${code} disconnected`);
        break;
      }
    }
  });
});

server.listen(10000, () => console.log("Server running on port 10000"));
