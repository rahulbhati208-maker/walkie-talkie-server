const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// Keep track of connected users/admins
let users = {};    // socketId -> {name, socketId}
let admins = {};   // socketId -> {name, socketId}

// ====== ROUTES ======
app.get("/", (req, res) => res.send("Walkie Server Running"));

// ====== SOCKET.IO ======
io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // ===== USER REGISTRATION =====
  socket.on("register-user", ({ name }) => {
    users[socket.id] = { name, socketId: socket.id };
    console.log("User registered:", name);

    // Assign first admin (if any) to this user
    const adminIds = Object.keys(admins);
    let assignedAdmin = adminIds.length ? adminIds[0] : null;
    if(assignedAdmin){
      socket.emit("assign-admin", assignedAdmin);
    }

    // Notify all admins of new user
    for(let aid of adminIds){
      io.to(aid).emit("user-joined", { id: socket.id, name });
    }

    // Send current users to this admin if admin connects later
  });

  // ===== ADMIN REGISTRATION =====
  socket.on("register-admin", () => {
    admins[socket.id] = { name: "Admin", socketId: socket.id };
    console.log("Admin connected:", socket.id);

    // Send current users to this admin
    const userList = Object.values(users);
    socket.emit("current-users", userList);
  });

  // ===== SIGNALING =====
  socket.on("signal", (data) => {
    const targetId = data.targetId;
    if(targetId) {
      io.to(targetId).emit("signal", { id: socket.id, data });
    }
  });

  // ===== USER DISCONNECT =====
  socket.on("disconnect", () => {
    if(users[socket.id]){
      const name = users[socket.id].name;
      console.log("User disconnected:", name);
      delete users[socket.id];
      // Notify all admins
      for(let aid of Object.keys(admins)){
        io.to(aid).emit("user-left", socket.id);
      }
    }
    if(admins[socket.id]){
      console.log("Admin disconnected:", socket.id);
      delete admins[socket.id];
      // Notify all users
      for(let uid of Object.keys(users)){
        io.to(uid).emit("admin-left", socket.id);
      }
    }
  });
});

server.listen(PORT, () => console.log(`Walkie server running on port ${PORT}`));
