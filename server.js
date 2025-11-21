const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors:{ origin:"*" } });

const PORT = process.env.PORT || 10000;

let admins={}; // code:{socketId, users:{}}
let users={};  // socketId:{name, adminCode}

// Unique admin code generator
const generateCode = ()=>Math.random().toString(36).substring(2,8);

io.on('connection', socket=>{
  console.log("Connected:", socket.id);

  socket.on('register-admin', ()=>{
    const code = generateCode();
    admins[code] = {socketId: socket.id, users:{}};
    socket.emit("admin-registered", code);
  });

  socket.on('register-user', ({name, adminCode})=>{
    if(!admins[adminCode]) return socket.emit("admin-offline");
    users[socket.id]={name, adminCode};
    admins[adminCode].users[socket.id]=users[socket.id];
    socket.join(adminCode);
    socket.emit("admin-online");
    io.to(admins[adminCode].socketId).emit("user-joined",{id:socket.id,name});
  });

  socket.on('offer', ({target,sdp})=>{
    io.to(target).emit("offer",{from:socket.id,sdp});
  });

  socket.on('answer', ({target,sdp})=>{
    io.to(target).emit("answer",{from:socket.id,sdp});
  });

  socket.on('ice-candidate', ({target,candidate})=>{
    io.to(target).emit("ice-candidate",{from:socket.id,candidate});
  });

  socket.on('disconnect', ()=>{
    const u = users[socket.id];
    if(u){
      io.to(u.adminCode).emit("user-left",{id:socket.id});
      delete admins[u.adminCode].users[socket.id];
      delete users[socket.id];
    } else {
      // admin disconnect
      for(let code in admins){
        if(admins[code].socketId===socket.id){
          for(let uid in admins[code].users){
            io.to(uid).emit("admin-offline");
          }
          delete admins[code];
        }
      }
    }
  });
});

server.listen(PORT, ()=>console.log("Server running on port",PORT));
