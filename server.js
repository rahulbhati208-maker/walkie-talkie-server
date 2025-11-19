const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ---------------------------
// MATCHMAKING QUEUE
// ---------------------------
let waitingPlayer = null;

// ---------------------------
// ROOM STORAGE
// ---------------------------
const activeRooms = new Map(); // roomCode → [player1, player2]

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// ---------------------------
// SOCKET CONNECTION
// ---------------------------
io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.emit("server_status", "online");

    // ---------------------------
    // AUTO-MATCH MAKING
    // ---------------------------
    socket.on("find_match", () => {
        if (waitingPlayer == null) {
            waitingPlayer = socket.id;
            socket.emit("match_status", "searching");
        } else {
            const p1 = waitingPlayer;
            const p2 = socket.id;
            waitingPlayer = null;

            const room = `match_${p1}_${p2}`;

            socket.join(room);
            io.to(p1).socketsJoin(room);

            io.to(room).emit("match_found", {
                room: room,
                players: [p1, p2]
            });
        }
    });

    // ---------------------------
    // PLAY WITH FRIEND – CREATE ROOM
    // ---------------------------
    socket.on("create_room", () => {
        const code = generateRoomCode();
        socket.join(code);
        activeRooms.set(code, [socket.id]);
        socket.emit("room_created", code);
    });

    // ---------------------------
    // PLAY WITH FRIEND – JOIN ROOM
    // ---------------------------
    socket.on("join_room", (code) => {
        if (!activeRooms.has(code)) {
            socket.emit("room_error", "Room does not exist");
            return;
        }

        const players = activeRooms.get(code);

        if (players.length >= 2) {
            socket.emit("room_error", "Room full");
            return;
        }

        players.push(socket.id);
        socket.join(code);

        io.to(code).emit("room_ready", {
            room: code,
            players: players
        });
    });

    // ---------------------------
    // GAME RELAY EVENTS (BOARD)
    // ---------------------------
    socket.on("move", (data) => {
        socket.to(data.room).emit("move", data);
    });

    // ---------------------------
    // TIMER / TURN SYNC
    // ---------------------------
    socket.on("turn", (data) => {
        socket.to(data.room).emit("turn", data);
    });

    // ---------------------------
    // EMOJI SEND
    // ---------------------------
    socket.on("emoji", (data) => {
        socket.to(data.room).emit("emoji", data);
    });

    // ---------------------------
    // PLAYER LEFT
    // ---------------------------
    socket.on("leave_room", (room) => {
        socket.leave(room);
        socket.to(room).emit("opponent_left");
    });

    // ---------------------------
    // WEBRTC VOICE RELAY
    // ---------------------------
    socket.on("webrtc_offer", (data) => {
        socket.to(data.room).emit("webrtc_offer", data);
    });

    socket.on("webrtc_answer", (data) => {
        socket.to(data.room).emit("webrtc_answer", data);
    });

    socket.on("webrtc_ice", (data) => {
        socket.to(data.room).emit("webrtc_ice", data);
    });

    // ---------------------------
    // DISCONNECT HANDLING
    // ---------------------------
    socket.on("disconnect", () => {
        console.log(`User disconnected: ${socket.id}`);

        if (waitingPlayer === socket.id) {
            waitingPlayer = null;
        }

        activeRooms.forEach((players, code) => {
            if (players.includes(socket.id)) {
                io.to(code).emit("opponent_left");
                activeRooms.delete(code);
            }
        });
    });
});

server.listen(3000, () => {
    console.log("Server running on port 3000");
});
