const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" }
});

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("signal", (data) => {
        socket.broadcast.emit("signal", {
            id: socket.id,
            data: data
        });
    });

    socket.on("talk-start", () => {
        socket.broadcast.emit("talk-start", socket.id);
    });

    socket.on("talk-stop", () => {
        socket.broadcast.emit("talk-stop", socket.id);
    });

    socket.on("disconnect", () => {
        console.log("User left:", socket.id);
        socket.broadcast.emit("user-left", socket.id);
    });
});

// IMPORTANT FOR RENDER
const PORT = process.env.PORT || 1000;

server.listen(PORT, () => {
    console.log("WebSocket server running on port " + PORT);
});
