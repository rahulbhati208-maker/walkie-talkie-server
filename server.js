const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const users = {}; // socketId => { name, role: "user" | "admin" }

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Register a user with a name
  socket.on("register-user", ({ name }) => {
    users[socket.id] = { name, role: "user" };
    console.log("User registered:", name);
    socket.broadcast.emit("user-joined", { id: socket.id, name });
  });

  // Admin registration (optional if needed)
  socket.on("register-admin", () => {
    users[socket.id] = { name: "Admin", role: "admin" };
    console.log("Admin connected:", socket.id);
  });

  // Signal messages for WebRTC
  socket.on("signal", (data) => {
    const target = io.sockets.sockets.get(data.targetId);
    if(target) target.emit("signal", { id: socket.id, data });
  });

  socket.on("disconnect", () => {
    if(users[socket.id]){
      const user = users[socket.id];
      console.log("User disconnected:", user.name || socket.id);
      socket.broadcast.emit("user-left", socket.id);
      delete users[socket.id];
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
