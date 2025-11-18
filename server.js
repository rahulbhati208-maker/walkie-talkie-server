const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
let users = {}; // socketId -> true

io.on("connection", socket => {
  console.log("Connected:", socket.id);
  users[socket.id] = true;
  io.emit("user-list", Object.keys(users));

  socket.on("signal", ({ targetId, data }) => {
    if(targetId && users[targetId]) {
      io.to(targetId).emit("signal", { id: socket.id, data });
    }
  });

  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("user-list", Object.keys(users));
    console.log("Disconnected:", socket.id);
  });
});

server.listen(PORT, () => console.log("Server running on port", PORT));
