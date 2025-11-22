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

function gen4() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("conn:", socket.id);

  // ---------- ADMIN ----------
  socket.on("register-admin", () => {
    let code;
    do { code = gen4(); } while (admins[code]);
    admins[code] = { socketId: socket.id, users: {} };
    socket.emit("admin-registered", code);
    console.log("admin code:", code);

    socket.on("disconnect", () => {
      const entry = admins[code];
      if (entry) {
        Object.keys(entry.users).forEach(uid => {
          console.log("notify user admin-offline ->", uid);
          io.to(uid).emit("admin-offline");
        });
        delete admins[code];
        console.log("admin disconnected:", code);
      }
    });

    // admin -> user: offer (renegotiate when admin adds tracks)
    socket.on("offer-from-admin", ({ target, sdp }) => {
      console.log("admin offer ->", target);
      io.to(target).emit("offer-from-admin", { from: socket.id, sdp });
    });

    socket.on("ice-from-admin", ({ target, candidate }) => {
      io.to(target).emit("ice-from-admin", { from: socket.id, candidate });
    });

    // admin toggles broadcast and talk-to-user (server just forwards notifications)
    socket.on("admin-broadcast-toggle", (enabled) => {
      const room = admins[code];
      if (!room) return;
      Object.keys(room.users).forEach(uid => io.to(uid).emit("admin-broadcast", { enabled }));
    });

    socket.on("admin-talk-toggle", ({ target, enabled }) => {
      const room = admins[code];
      if (!room) return;
      io.to(target).emit("admin-talk", { enabled });
      Object.keys(room.users).forEach(uid => {
        if (uid !== target) io.to(uid).emit("admin-talk", { enabled: false });
      });
    });

    // admin may request users list
    socket.on("request-users", () => {
      const room = admins[code];
      if (!room) return;
      const list = Object.entries(room.users).map(([id, u]) => ({ id, name: u.name }));
      socket.emit("users-list", list);
    });

    // admin can emit 'answer-from-admin' to forward answer to a specific user (for initial user->admin offer)
    socket.on("answer-from-admin", ({ target, sdp }) => {
      io.to(target).emit("answer-from-admin", { from: socket.id, sdp });
    });

    // server convenience: allow admin to forward arbitrary event
    socket.on("forward-to-user", ({ target, ev, payload }) => {
      io.to(target).emit(ev, payload);
    });
  });

  // ---------- USER ----------
  socket.on("register-user", ({ name, adminCode }) => {
    if (!admins[adminCode]) {
      socket.emit("admin-not-found");
      return;
    }
    users[socket.id] = { name, adminCode };
    admins[adminCode].users[socket.id] = { name };
    socket.emit("admin-online");
    io.to(admins[adminCode].socketId).emit("user-joined", { id: socket.id, name });
    console.log("user joined:", name, "->", adminCode);

    socket.on("disconnect", () => {
      const u = users[socket.id];
      if (u) {
        const ac = u.adminCode;
        if (admins[ac]) {
          delete admins[ac].users[socket.id];
          io.to(admins[ac].socketId).emit("user-left", { id: socket.id });
        }
        delete users[socket.id];
        console.log("user disconnected:", socket.id);
      }
    });

    // initial offer from user -> admin
    socket.on("offer-to-admin", ({ sdp }) => {
      const adminSocket = admins[adminCode].socketId;
      io.to(adminSocket).emit("offer-from-user", { from: socket.id, sdp, name });
    });

    // ICE from user -> admin (initial offer flow)
    socket.on("ice-to-admin", ({ candidate }) => {
      const adminSocket = admins[adminCode].socketId;
      io.to(adminSocket).emit("ice-from-user", { from: socket.id, candidate });
    });

    // answer-to-admin (user replies to admin's renegotiation offer)
    socket.on("answer-to-admin", ({ sdp }) => {
      const adminSocket = admins[adminCode].socketId;
      io.to(adminSocket).emit("answer-from-user", { from: socket.id, sdp });
    });

    // ice for renegotiation => forwarded
    socket.on("ice-to-admin-after", ({ candidate }) => {
      const adminSocket = admins[adminCode].socketId;
      io.to(adminSocket).emit("ice-from-user-after", { from: socket.id, candidate });
    });

    // user speaking events to admin (UI indicator & logs)
    socket.on("user-speaking", ({ speaking, ts }) => {
      const u = users[socket.id];
      if (!u) return;
      const adminSocket = admins[u.adminCode].socketId;
      io.to(adminSocket).emit("user-speaking", { id: socket.id, name: u.name, speaking, ts });
    });

    // session-end forwarded to admin as log-event
    socket.on("session-end", (entry) => {
      const u = users[socket.id];
      if (!u) return;
      const adminSocket = admins[u.adminCode].socketId;
      io.to(adminSocket).emit("log-event", entry);
    });

    // user convenience: forward any event to admin
    socket.on("forward-to-admin", ({ ev, payload }) => {
      const adminSocket = admins[adminCode].socketId;
      io.to(adminSocket).emit(ev, payload);
    });
  });

  // generic forward helper (optional)
  socket.on("forward", ({ to, ev, payload }) => {
    if (to) io.to(to).emit(ev, payload);
  });
});

server.listen(PORT, () => console.log("Server running on port", PORT));
