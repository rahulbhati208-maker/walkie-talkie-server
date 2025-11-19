const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users for admin view
const connectedUsers = new Map();

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    connectedUsers.set(socket.id, { id: socket.id, connectedAt: new Date() });

    // Send updated user list to admin when someone connects
    broadcastUserList();

    socket.on("signal", (data) => {
        // If targetId is specified, send only to that user
        if (data.targetId) {
            socket.to(data.targetId).emit("signal", {
                id: socket.id,
                data: data
            });
        } else {
            // Broadcast to all other users
            socket.broadcast.emit("signal", {
                id: socket.id,
                data: data
            });
        }
    });

    socket.on("talk-start", () => {
        socket.broadcast.emit("talk-start", socket.id);
    });

    socket.on("talk-stop", () => {
        socket.broadcast.emit("talk-stop", socket.id);
    });

    socket.on("disconnect", () => {
        console.log("User left:", socket.id);
        connectedUsers.delete(socket.id);
        socket.broadcast.emit("user-left", socket.id);
        broadcastUserList();
    });
});

function broadcastUserList() {
    const users = Array.from(connectedUsers.values());
    io.emit("user-list", users);
}

// Routes
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user.html'));
});

app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// IMPORTANT FOR RENDER
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
    console.log("User page: http://localhost:" + PORT);
    console.log("Admin page: http://localhost:" + PORT + "/admin");
});
