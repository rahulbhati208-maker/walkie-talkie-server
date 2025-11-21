const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors:{ origin:"*" } });

const PORT = process.env.PORT || 10000;

let admins = {}; // adminCode: {socketId, users:{}}
let users = {}; // socketId: {name, adminCode, talking=false, startTime=null}

// Generate unique code
const generateCode = () => Math.random().toString(36).substring(2,8);

io.on('connection', socket=>{
  console.log("Connected:", socket.id);

  // Register admin
  socket.on('register-admin', ()=>{
    const code = generateCode();
    admins[code] = {socketId: socket.id, users:{}};
    socket.emit("admin-registered", code);
  });

  // Register user
  socket.on('register-user', ({name, adminCode})=>{
    if(!admins[adminCode]) return socket.emit("admin-offline");
    users[socket.id] = {name, adminCode, talking:false, startTime:null};
    admins[adminCode].users[socket.id] = users[socket.id];
    socket.join(adminCode);

    socket.emit("admin-online");
    io.to(admins[adminCode].socketId).emit("user-joined", {id:socket.id,name});
  });

  // User talk toggle
  socket.on('user-talk-toggle', (active)=>{
    const u = users[socket.id];
    if(!u) return;
    u.talking = active;
    if(active) u.startTime = Date.now();
    else {
      const duration = Math.floor((Date.now()-u.startTime)/1000);
      io.to(admins[u.adminCode].socketId).emit("log-event", {from:u.name, to:"Admin", duration});
      u.startTime = null;
    }
    io.to(u.adminCode).emit("user-speaking",{id:socket.id,speaking:active});
  });

  // Admin talk toggle to user
  socket.on('admin-talk-toggle', ({target, active})=>{
    const u = users[target];
    if(!u) return;
    if(active) u.startTime = Date.now();
    else if(u.startTime){
      const duration = Math.floor((Date.now()-u.startTime)/1000);
      io.to(socket.id).emit("log-event", {from:"Admin", to:u.name, duration});
      u.startTime = null;
    }
    io.to(target).emit("admin-speaking",{speaking:active});
  });

  // Broadcast toggle
  socket.on('broadcast-toggle', (active)=>{
    const adminEntry = Object.values(admins).find(a=>a.socketId===socket.id);
    if(!adminEntry) return;
    for(let uid in adminEntry.users){
      io.to(uid).emit("admin-speaking",{speaking:active});
    }
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
