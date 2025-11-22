// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 10000;

// Data structures
// admins: code -> { socketId, users: { socketId: { name, socketId } } }
const admins = {};
// users: socketId -> { name, adminCode, socketId }
const users = {};

// generate 4-digit code as string
function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("socket connected", socket.id);

  // Admin registers to get a 4-digit code
  socket.on("register-admin", () => {
    let code;
    do { code = generateCode(); } while (admins[code]); // avoid collision
    admins[code] = { socketId: socket.id, users: {} };
    socket.emit("admin-registered", code);
    console.log("Admin registered:", code);

    // clean-up if admin disconnects
    socket.on("disconnect", () => {
      console.log("Admin disconnected:", code);
      // notify users in that room
      const adminEntry = admins[code];
      if (adminEntry) {
        Object.keys(adminEntry.users).forEach((uid) => {
          try { io.to(uid).emit("admin-offline"); } catch (e) {}
        });
        delete admins[code];
      }
    });

    // admin toggles broadcast (enable/disable admin audio to all users)
    socket.on("admin-broadcast-toggle", (enabled) => {
      const adminEntry = admins[code];
      if (!adminEntry) return;
      Object.keys(adminEntry.users).forEach(uid => {
        io.to(uid).emit("admin-broadcast", { enabled });
      });
    });

    // admin wants to talk to specific user (enable/disable)
    // { targetSocketId, enabled }
    socket.on("admin-talk-toggle", ({ target, enabled }) => {
      const adminEntry = admins[code];
      if (!adminEntry) return;
      // notify that user to expect admin audio
      io.to(target).emit("admin-talk", { enabled });
      // notify other users admin stopped for them (option B)
      Object.keys(adminEntry.users).forEach(uid => {
        if (uid !== target) io.to(uid).emit("admin-talk", { enabled: false });
      });
      // server also emit a log event when admin stops (client responsible for duration end logging)
      // For simplicity, clients will emit session-end events; server just forwards.
    });

    // forward signaling messages from admin to a user target
    socket.on("admin-offer", ({ target, sdp }) => {
      if (admins[code] && admins[code].users[target]) {
        io.to(target).emit("offer-from-admin", { from: socket.id, sdp });
      }
    });

    socket.on("admin-ice", ({ target, candidate }) => {
      io.to(target).emit("ice-from-admin", { from: socket.id, candidate });
    });

    // admin may ask server to request current users list
    socket.on("request-users", () => {
      const adminEntry = admins[code];
      if (!adminEntry) return;
      const list = Object.entries(adminEntry.users).map(([id, u]) => ({ id, name: u.name }));
      socket.emit("users-list", list);
    });
  });

  // User registers with adminCode and name
  socket.on("register-user", ({ name, adminCode }) => {
    if (!admins[adminCode]) {
      socket.emit("admin-not-found");
      return;
    }
    // keep user
    users[socket.id] = { name, adminCode, socketId: socket.id };
    admins[adminCode].users[socket.id] = { name, socketId: socket.id };
    socket.emit("admin-online");
    // tell admin someone joined
    const adminSocketId = admins[adminCode].socketId;
    io.to(adminSocketId).emit("user-joined", { id: socket.id, name });

    // user disconnect cleanup
    socket.on("disconnect", () => {
      if (users[socket.id]) {
        const { adminCode: ac } = users[socket.id];
        if (admins[ac]) {
          delete admins[ac].users[socket.id];
          io.to(admins[ac].socketId).emit("user-left", { id: socket.id });
        }
        delete users[socket.id];
      }
    });

    // user -> admin signaling: user creates offer and sends it to admin
    socket.on("offer-to-admin", ({ sdp }) => {
      const adminSocketId = admins[adminCode].socketId;
      io.to(adminSocketId).emit("offer-from-user", { from: socket.id, sdp, name });
    });

    socket.on("ice-to-admin", ({ candidate }) => {
      const adminSocketId = admins[adminCode].socketId;
      io.to(adminSocketId).emit("ice-from-user", { from: socket.id, candidate });
    });

    // user sends answer (after admin creates offer for renegotiation) - forwarded to admin
    socket.on("answer-to-admin", ({ sdp }) => {
      const adminSocketId = admins[adminCode].socketId;
      io.to(adminSocketId).emit("answer-from-user", { from: socket.id, sdp });
    });

    // user tells server when they start/stop talking (so server can log and forward)
    // { speaking: true/false, ts: Date.now() }
    socket.on("user-speaking", ({ speaking, ts }) => {
      const u = users[socket.id];
      if (!u) return;
      const adminSocketId = admins[u.adminCode].socketId;
      // forward to admin so admin UI can show speaking indicator
      io.to(adminSocketId).emit("user-speaking", { id: socket.id, name: u.name, speaking, ts });
      // server can track durations if desired; but we'll let clients compute durations and emit 'session-end' to server
    });

    // user or admin emit session-end to log
    // { from, to, startTs, endTs }
    socket.on("session-end", (entry) => {
      // forward to admin (for display)
      const adminSocketId = admins[users[socket.id]?.adminCode]?.socketId || null;
      if (adminSocketId) io.to(adminSocketId).emit("log-event", entry);
    });

    // Admin may also ask to rename a user (admin emits this)
    socket.on("rename-to-admin", ({ target, newName }) => {
      // only meaningful from admin-side but leaving for completeness
      const adminSocket = admins[adminCode];
      if (adminSocket && adminSocket.users[target]) {
        admins[adminCode].users[target].name = newName;
        io.to(target).emit("name-updated", { newName });
        io.to(adminSocket.socketId).emit("user-renamed", { id: target, newName });
      }
    });
  });

  // global ICE/result forwarding if messages include to/from fields (safety)
  socket.on("forward", ({ to, ev, payload }) => {
    if (to) io.to(to).emit(ev, payload);
  });
});

server.listen(PORT, () => console.log("Signaling server running on port", PORT));
