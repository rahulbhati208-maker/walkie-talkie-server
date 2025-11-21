const express = require("express");
const https = require("https");
const fs = require("fs");
const socketIO = require("socket.io");

const app = express();
app.use(express.static("public"));

const server = https.createServer({
  key: fs.readFileSync("./ssl/key.pem"),
  cert: fs.readFileSync("./ssl/cert.pem"),
}, app);

const io = socketIO(server, {
  cors: { origin: "*" }
});

let users = {};

io.on("connection", socket => {

  users[socket.id] = { id: socket.id, name: "User" + socket.id.slice(0,4) };

  io.emit("user-online", Object.values(users));
  socket.emit("connected");

  socket.on("disconnect", ()=>{
    delete users[socket.id];
    io.emit("user-online", Object.values(users));
  });

  socket.on("start-talk", ()=>{
    io.emit("play-voice", socket.id);
  });

  socket.on("stop-talk", ()=>{
    io.emit("stop-voice", socket.id);
  });

  socket.on("offer", data=>{
    io.to(data.to).emit("offer",{from:socket.id,offer:data.offer});
  });

  socket.on("answer", data=>{
    io.to(data.to).emit("answer",{from:socket.id,answer:data.answer});
  });

  socket.on("candidate", data=>{
    if(data.to){
      io.to(data.to).emit("candidate",{from:socket.id,candidate:data.candidate});
    } else {
      socket.broadcast.emit("candidate",{from:socket.id,candidate:data});
    }
  });

});

server.listen(10000, ()=>console.log("Server running 10000 HTTPS ✔"));
