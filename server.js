import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket (Socket.io) server
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// When a client connects
io.on("connection", (socket) => {
  console.log("🔌 New user connected:", socket.id);

  // For user joining a room
  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`👥 User: ${socket.id} joined room: ${roomId}`);
    socket.to(roomId).emit("userJoined", socket.id);
  });

  // Forward voice data
  socket.on("voiceData", (data) => {
    socket.to(data.room).emit("voiceData", data.buffer);
  });

  // Messaging support
  socket.on("sendMessage", (data) => {
    io.to(data.room).emit("receiveMessage", {
      message: data.message,
      user: socket.id
    });
  });

  // Disconnect handler
  socket.on("disconnect", () =>
    console.log("❌ User disconnected:", socket.id)
  );
});

const PORT = 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on PORT ${PORT}`);
});

// For testing API
app.get("/", (req, res) => {
  res.send("Server is running!");
});
