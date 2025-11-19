import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let waitingPlayer = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.emit("info", "Searching for online players...");

  // Matchmaking
  if (!waitingPlayer) {
    waitingPlayer = socket;
    socket.emit("info", "Waiting for opponent...");
  } else {
    let player1 = waitingPlayer;
    let player2 = socket;
    waitingPlayer = null;

    // Assign symbols
    player1.symbol = "X";
    player2.symbol = "O";

    // Create room
    let roomId = player1.id + player2.id;
    player1.join(roomId);
    player2.join(roomId);

    // Tell players
    io.to(roomId).emit("matchFound", { roomId });

    player1.emit("symbol", "X");
    player2.emit("symbol", "O");

    startGame(player1, player2, roomId);
  }

  socket.on("play", ({ index, roomId }) => {
    io.to(roomId).emit("mark", { index, symbol: socket.symbol });
    io.to(roomId).emit("turn", socket.opponent);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    if (waitingPlayer?.id === socket.id) waitingPlayer = null;
  });
});

function startGame(p1, p2, roomId) {
  p1.opponent = "O";
  p2.opponent = "X";

  io.to(roomId).emit("start", {
    message: "Game Started!",
    firstTurn: "X"
  });
}

server.listen(10000, () => console.log("Server running on 10000"));
