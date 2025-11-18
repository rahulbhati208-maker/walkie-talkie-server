const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

let users = {};   // socketId -> true
let admins = {};  // socketId -> true

io.on("connection", socket => {
  console.log("Connected:", socket.id);

  // register role
  socket.on("register", role => {
    if(role==="admin") admins[socket.id]=true;
    if(role==="user") users[socket.id]=true;

    // send lists
    io.to(socket.id).emit("user-list", Object.keys(users));
    io.to(socket.id).emit("admin-list", Object.keys(admins));

    // notify admins about new user
    if(role==="user"){
      for(let a of Object.keys(admins)){
        io.to(a).emit("user-list", Object.keys(users));
      }
    }

    // notify users about new admin
    if(role==="admin"){
      for(let u of Object.keys(users)){
        io.to(u).emit("admin-list", Object.keys(admins));
      }
    }
  });

  // signaling
  socket.on("signal", ({targetId, data})=>{
    if(targetId) io.to(targetId).emit("signal",{id:socket.id, data});
  });

  // disconnect
  socket.on("disconnect", ()=>{
    delete users[socket.id];
    delete admins[socket.id];
    io.emit("user-list", Object.keys(users));
    io.emit("admin-list", Object.keys(admins));
    console.log("Disconnected:", socket.id);
  });
});

server.listen(PORT, ()=>console.log("Server running on port", PORT));
