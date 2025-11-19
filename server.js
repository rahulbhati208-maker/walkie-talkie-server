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

// AUTO MATCH QUEUE
let queue = null;

// ROOMS for play with friend
let rooms = {};

io.on("connection", (socket) => {

    console.log("✔ User connected:", socket.id);

    // ===========================
    // AUTO MATCH
    // ===========================
    socket.on("findMatch", () => {
        if (!queue) {
            queue = socket;
            socket.emit("matchWaiting");
        } else {
            // Pair both users
            let p1 = queue;
            let p2 = socket;

            p1.emit("matchFound", { opponent: p2.id, youAre: "X" });
            p2.emit("matchFound", { opponent: p1.id, youAre: "O" });

            p1.opponent = p2.id;
            p2.opponent = p1.id;

            queue = null;
        }
    });

    // ===========================
    // PLAY WITH COMPUTER
    // ===========================
    socket.on("startComputerGame", (difficulty) => {
        socket.emit("computerGameStarted", difficulty);
    });

    // ===========================
    // PLAY WITH FRIEND
    // ===========================
    socket.on("createRoom", () => {
        let code = Math.floor(1000 + Math.random() * 9000).toString();

        rooms[code] = {
            host: socket.id,
            guest: null
        };

        socket.join(code);
        socket.emit("roomCreated", code);
    });

    socket.on("joinRoom", (code) => {
        if (!rooms[code]) {
            socket.emit("roomError", "Room does not exist!");
            return;
        }

        if (rooms[code].guest) {
            socket.emit("roomError", "Room already full!");
            return;
        }

        rooms[code].guest = socket.id;

        socket.join(code);

        // Notify both users
        io.to(rooms[code].host).emit("friendJoined", { opponent: socket.id, youAre: "X" });
        io.to(socket.id).emit("friendJoined", { opponent: rooms[code].host, youAre: "O" });
    });

    // ===========================
    // GAME EVENTS
    // ===========================
    socket.on("playerMove", (data) => {
        io.to(data.opponent).emit("opponentMove", data);
    });

    socket.on("sendEmoji", (data) => {
        io.to(data.opponent).emit("receiveEmoji", data.emoji);
    });

    socket.on("muteStatus", (data) => {
        io.to(data.opponent).emit("opponentMute", data.muted);
    });

    // ===========================
    // VOICE CHAT RELAY
    // ===========================
    socket.on("voiceStream", (data) => {
        io.to(data.opponent).emit("voiceStream", data.chunk);
    });

    socket.on("disconnect", () => {
        console.log("✖ Disconnected:", socket.id);

        // clear queue
        if (queue && queue.id === socket.id) queue = null;

        // clean rooms
        Object.keys(rooms).forEach(code => {
            if (rooms[code].host === socket.id || rooms[code].guest === socket.id) {
                io.to(code).emit("opponentLeft");
                delete rooms[code];
            }
        });
    });

});

server.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});
