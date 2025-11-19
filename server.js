const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- GAME SETTINGS --- //
const TURN_TIME = 20000; // 20 seconds
const DISCONNECT_LIMIT = 40000; // 40 seconds for win by disconnect

// --- GLOBALS --- //
let waitingPlayer = null;
let matches = {}; // roomId → match data
let reconnectMap = {}; // reconnect token → socketId/room etc.

// ----------- UTIL ----------- //
function makeId() {
  return "R" + Math.random().toString(36).substring(2, 10);
}

// ------------------------------------
// SOCKET CONNECTION
// ------------------------------------
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // CLIENT SEND TOKEN FOR RECONNECTION
  socket.on("reconnect_token", (token) => {
    if (reconnectMap[token]) {
      let info = reconnectMap[token];
      socket.join(info.roomId);
      socket.symbol = info.symbol;
      socket.token = token;

      matches[info.roomId].players[socket.symbol] = socket.id;
      matches[info.roomId].lastSeen[socket.symbol] = Date.now();

      io.to(info.roomId).emit("player_reconnected", {
        symbol: socket.symbol
      });

      socket.emit("reconnected", {
        roomId: info.roomId,
        symbol: info.symbol,
        board: matches[info.roomId].board,
        turn: matches[info.roomId].turn,
        remaining: matches[info.roomId].turnEndsAt - Date.now()
      });
    }
  });

  // JOIN MATCHMAKING
  socket.on("join", () => {
    socket.token = makeId();
    socket.emit("save_token", socket.token);

    if (!waitingPlayer) {
      waitingPlayer = socket;
      socket.emit("status", "Waiting for opponent...");
      return;
    }

    // MATCH FOUND
    let p1 = waitingPlayer;
    let p2 = socket;
    waitingPlayer = null;

    let roomId = makeId();
    p1.join(roomId);
    p2.join(roomId);

    // Assign symbols
    p1.symbol = "X";
    p2.symbol = "O";

    // Store reconnect mapping
    reconnectMap[p1.token] = { roomId, symbol: "X" };
    reconnectMap[p2.token] = { roomId, symbol: "O" };

    // Create match object
    matches[roomId] = {
      board: ["", "", "", "", "", "", "", "", ""],
      turn: "X",
      players: {
        X: p1.id,
        O: p2.id
      },
      lastSeen: {
        X: Date.now(),
        O: Date.now()
      },
      turnEndsAt: Date.now() + TURN_TIME,
      timeoutId: null,
      disconnectCheckId: null
    };

    // Send match start
    io.to(roomId).emit("matchFound", {
      roomId,
      yourSymbol: {
        [p1.id]: "X",
        [p2.id]: "O"
      }
    });

    startTurn(roomId);
  });

  // PLAYER MOVE
  socket.on("play", ({ roomId, index }) => {
    if (!matches[roomId]) return;

    let match = matches[roomId];
    let symbol = socket.symbol;

    if (match.turn !== symbol) return;
    if (match.board[index] !== "") return;

    match.board[index] = symbol;

    io.to(roomId).emit("update_board", match.board);

    let winner = checkWin(match.board);
    if (winner) return endMatch(roomId, winner);

    match.turn = symbol === "X" ? "O" : "X";
    startTurn(roomId);
  });

  // PLAYER LEAVES
  socket.on("leave", ({ roomId }) => {
    if (!matches[roomId]) return;
    let match = matches[roomId];
    let winner = socket.symbol === "X" ? "O" : "X";
    endMatch(roomId, winner, "Opponent left");
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    for (let roomId in matches) {
      let match = matches[roomId];

      if (match.players.X === socket.id || match.players.O === socket.id) {
        let symbol = match.players.X === socket.id ? "X" : "O";
        match.lastSeen[symbol] = Date.now();

        io.to(roomId).emit("player_disconnected", { symbol });

        match.disconnectCheckId = setTimeout(() => {
          if (Date.now() - match.lastSeen[symbol] >= DISCONNECT_LIMIT) {
            let winner = symbol === "X" ? "O" : "X";
            endMatch(roomId, winner, "Opponent disconnected 40s");
          }
        }, DISCONNECT_LIMIT);
      }
    }
  });
});

// ------------------------------------
// TURN TIMER
// ------------------------------------
function startTurn(roomId) {
  let match = matches[roomId];

  match.turnEndsAt = Date.now() + TURN_TIME;

  clearTimeout(match.timeoutId);

  io.to(roomId).emit("turn", {
    turn: match.turn,
    remaining: TURN_TIME
  });

  match.timeoutId = setTimeout(() => {
    match.turn = match.turn === "X" ? "O" : "X";
    startTurn(roomId);
  }, TURN_TIME);
}

// ------------------------------------
// CHECK WINNER
// ------------------------------------
function checkWin(b) {
  const wins = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (let [a,b1,c] of wins) {
    if (b[a] && b[a] === b[b1] && b[a] === b[c]) return b[a];
  }
  if (b.every(x => x !== "")) return "DRAW";
  return null;
}

// ------------------------------------
// END MATCH
// ------------------------------------
function endMatch(roomId, winner, reason = "Win") {
  io.to(roomId).emit("match_end", {
    winner,
    reason
  });

  clearTimeout(matches[roomId]?.timeoutId);
  clearTimeout(matches[roomId]?.disconnectCheckId);
  delete matches[roomId];
}

server.listen(10000, () => console.log("Server running on 10000"));
