// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 10000;

const admins = {}; // code -> { socketId, users: { socketId: { name } } }
const users = {};  // socketId -> { name, adminCode }

function genCode(){
  return String(Math.floor(1000 + Math.random()*9000));
}

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("conn:", socket.id);

  // ADMIN register -> returns 4-digit code
  socket.on("register-admin", () => {
    let code;
    do { code = genCode(); } while (admins[code]);
    admins[code] = { socketId: socket.id, users: {} };
    socket.emit("admin-registered", code);
    console.log("admin created", code);

    socket.on("disconnect", () => {
      const entry = admins[code];
      if (entry) {
        // notify users admin offline
        Object.keys(entry.users).forEach(uid => io.to(uid).emit("admin-offline"));
        delete admins[code];
        console.log("admin disconnected", code);
      }
    });

    // admin toggles broadcast -> notify all users in room
    socket.on("admin-broadcast-toggle", (enabled) => {
      const room = admins[code];
      if (!room) return;
      Object.keys(room.users).forEach(uid => io.to(uid).emit("admin-broadcast", { enabled }));
    });

    // admin toggles talk to a particular user (option B)
    socket.on("admin-talk-toggle", ({ target, enabled }) => {
      const room = admins[code];
      if (!room) return;
      // notify target
      io.to(target).emit("admin-talk", { enabled });
      // notify others to stop
      Object.keys(room.users).forEach(uid => {
        if (uid !== target) io.to(uid).emit("admin-talk", { enabled: false });
      });
    });

    // admin receives offer-from-admin? (we will use admin->user renegotiation via 'offer-from-admin')
    socket.on("offer-from-admin", ({ target, sdp }) => {
      io.to(target).emit("offer-from-admin", { from: socket.id, sdp });
    });

    socket.on("ice-from-admin", ({ target, candidate }) => {
      io.to(target).emit("ice-from-admin", { from: socket.id, candidate });
    });

    // admin may request list
    socket.on("request-users", () => {
      const room = admins[code];
      if (!room) return;
      const list = Object.entries(room.users).map(([id, u]) => ({ id, name: u.name }));
      socket.emit("users-list", list);
    });
  });

  // USER register with adminCode & name
  socket.on("register-user", ({ name, adminCode }) => {
    if (!admins[adminCode]) {
      socket.emit("admin-not-found");
      return;
    }
    users[socket.id] = { name, adminCode };
    admins[adminCode].users[socket.id] = { name };
    socket.emit("admin-online");
    io.to(admins[adminCode].socketId).emit("user-joined", { id: socket.id, name });
    console.log("user joined", name, "->", adminCode);

    socket.on("disconnect", () => {
      const u = users[socket.id];
      if (u) {
        const ac = u.adminCode;
        if (admins[ac]) {
          delete admins[ac].users[socket.id];
          io.to(admins[ac].socketId).emit("user-left", { id: socket.id });
        }
        delete users[socket.id];
        console.log("user disconnected", socket.id);
      }
    });

    // user sends offer to admin (initial offer)
    socket.on("offer-to-admin", ({ sdp }) => {
      const adminSocket = admins[adminCode].socketId;
      io.to(adminSocket).emit("offer-from-user", { from: socket.id, sdp, name });
    });

    // user sends ICE to admin
    socket.on("ice-to-admin", ({ candidate }) => {
      const adminSocket = admins[adminCode].socketId;
      io.to(adminSocket).emit("ice-from-user", { from: socket.id, candidate });
    });

    // user receives offer-from-admin (renegotiation) -> user will answer and send answer-to-admin
    socket.on("answer-to-admin", ({ sdp }) => {
      const adminSocket = admins[adminCode].socketId;
      io.to(adminSocket).emit("answer-from-user", { from: socket.id, sdp });
    });

    // user ice to admin for renegotiation
    socket.on("ice-to-admin-after", ({ candidate }) => {
      const adminSocket = admins[adminCode].socketId;
      io.to(adminSocket).emit("ice-from-user-after", { from: socket.id, candidate });
    });

    // user speaking events for logs
    socket.on("user-speaking", ({ speaking, ts }) => {
      const u = users[socket.id];
      if (!u) return;
      const adminSocket = admins[u.adminCode].socketId;
      io.to(adminSocket).emit("user-speaking", { id: socket.id, name: u.name, speaking, ts });
    });

    // session-end forward
    socket.on("session-end", (entry) => {
      const u = users[socket.id];
      if (!u) return;
      const adminSocket = admins[u.adminCode].socketId;
      io.to(adminSocket).emit("log-event", entry);
    });
  });

  // Generic forwarding endpoints (if needed)
  socket.on("forward", ({ to, ev, payload }) => {
    if (to) io.to(to).emit(ev, payload);
  });
});

server.listen(PORT, () => console.log("Server running on port", PORT));
