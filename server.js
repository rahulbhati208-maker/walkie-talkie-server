const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// Store connected users: socketId => { name, role }
const users = {}; // role = "user" | "admin"

// ===== Socket.IO =====
io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Register a user with name
  socket.on("register-user", ({ name }) => {
    users[socket.id] = { name, role: "user" };
    console.log(`User registered: ${name} (${socket.id})`);

    // Notify all admins of new user
    socket.broadcast.emit("user-joined", { id: socket.id, name });
  });

  // Register admin
  socket.on("register-admin", () => {
    users[socket.id] = { name: "Admin", role: "admin" };
    console.log(`Admin connected: ${socket.id}`);

    // Send current users to this admin
    const currentUsers = Object.entries(users)
      .filter(([id,u]) => u.role === "user")
      .map(([id,u]) => ({ id, name: u.name }));

    socket.emit("current-users", currentUsers);
  });

  // Forward WebRTC signaling messages
  socket.on("signal", (data) => {
    const target = io.sockets.sockets.get(data.targetId);
    if(target) target.emit("signal", { id: socket.id, data });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    if(users[socket.id]){
      const user = users[socket.id];
      console.log(`Disconnected: ${user.name} (${socket.id})`);
      socket.broadcast.emit("user-left", socket.id);
      delete users[socket.id];
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
