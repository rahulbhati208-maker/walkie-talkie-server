// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

const PORT = process.env.PORT || 3000;
const TURN_TIME_MS = 20 * 1000;
const DISCONNECT_GRACE_MS = 40 * 1000;
const MATCH_SEARCH_TIMEOUT_MS = 15 * 1000;

function makeId(prefix='m') { return prefix + '_' + Math.random().toString(36).slice(2,9); }
function makeRoomCode() { return Math.floor(1000 + Math.random()*9000).toString(); }

let waitingQueue = []; // { playerId, socketId, username, queuedAt }
let players = {}; // playerId -> { socketId, username, lastSeen }
let matches = {}; // matchId -> match object
let rooms = {}; // roomCode -> { hostPlayerId, matchId } to support room create/join

function checkGameEnd(board) {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return { over:true, winner: board[a], line:[a,b,c] };
    }
  }
  if (board.every(cell => cell !== null && cell !== '')) return { over:true, winner:null, line:null };
  return { over:false };
}

function cleanupMatch(matchId) {
  const m = matches[matchId];
  if (!m) return;
  if (m.turnTimer) clearTimeout(m.turnTimer);
  if (m.disconnectTimers) Object.values(m.disconnectTimers).forEach(t => clearTimeout(t));
  delete matches[matchId];
}

function startTurnTimer(matchId) {
  const m = matches[matchId];
  if (!m) return;
  if (m.turnTimer) clearTimeout(m.turnTimer);

  const active = m.players[m.activeIndex];
  m.expiresAt = Date.now() + TURN_TIME_MS;

  io.to(m.room).emit('start_turn', { matchId, activePlayerId: active.playerId, expiresAt: m.expiresAt });

  m.turnTimer = setTimeout(() => {
    // timeout: push history and switch
    m.history.push({ type:'timeout', by: active.playerId, ts: Date.now() });
    m.activeIndex = 1 - m.activeIndex;
    io.to(m.room).emit('force_pass', { matchId, timedOutPlayer: active.playerId, nextActive: m.players[m.activeIndex].playerId });
    startTurnTimer(matchId);
  }, TURN_TIME_MS + 60);
}

function findMatchByPlayer(playerId) {
  return Object.values(matches).find(m => m.players.some(p => p.playerId === playerId));
}

// Matchmaking: pair two waiting players
function tryAutoMatch() {
  while (waitingQueue.length >= 2) {
    const a = waitingQueue.shift();
    const b = waitingQueue.shift();
    if (a.playerId === b.playerId) { waitingQueue.push(b); continue; }

    const matchId = makeId('match');
    const room = 'room_' + matchId;
    const starter = Math.round(Math.random());
    const pArr = [
      { playerId: a.playerId, socketId: a.socketId, username: a.username, symbol: starter===0?'X':'O' },
      { playerId: b.playerId, socketId: b.socketId, username: b.username, symbol: starter===1?'X':'O' }
    ];

    const match = {
      id: matchId, room,
      players: pArr,
      board: Array(9).fill(''),
      activeIndex: starter,
      history: [],
      expiresAt: null,
      turnTimer: null,
      disconnectTimers: {},
      createdAt: Date.now()
    };
    matches[matchId] = match;

    try { io.sockets.sockets.get(a.socketId).join(room); } catch(e){}
    try { io.sockets.sockets.get(b.socketId).join(room); } catch(e){}

    // notify individually (include which symbol the client will get)
    io.to(a.socketId).emit('match_found', { matchId, room, opponent: b.username, yourPlayerId: a.playerId, yourSymbol: pArr[0].playerId===a.playerId? pArr[0].symbol : pArr[1].symbol });
    io.to(b.socketId).emit('match_found', { matchId, room, opponent: a.username, yourPlayerId: b.playerId, yourSymbol: pArr[0].playerId===b.playerId? pArr[0].symbol : pArr[1].symbol });

    io.to(room).emit('match_start', { matchId, board: match.board, players: match.players.map(p=>({ playerId:p.playerId, username:p.username, symbol:p.symbol })) });

    startTurnTimer(matchId);
  }
}

// handle incoming socket connections
io.on('connection', socket => {
  console.log('[connect]', socket.id);

  // Join the lobby or create/join room by code
  socket.on('join_lobby', ({ username, playerId } = {}) => {
    if (!playerId) playerId = 'p_' + Math.random().toString(36).slice(2,10);
    username = (username && String(username).slice(0,30)) || ('Player_' + playerId.slice(-4));
    players[playerId] = { socketId: socket.id, username, lastSeen: Date.now() };
    socket.data.playerId = playerId;

    // if player was in a match (reconnect)
    const existing = findMatchByPlayer(playerId);
    if (existing) {
      const p = existing.players.find(pp => pp.playerId === playerId);
      if (p) {
        p.socketId = socket.id;
        socket.join(existing.room);
        if (existing.disconnectTimers && existing.disconnectTimers[playerId]) { clearTimeout(existing.disconnectTimers[playerId]); delete existing.disconnectTimers[playerId]; }
        players[playerId].lastSeen = Date.now();
        socket.emit('reconnected', { matchId: existing.id, board: existing.board, yourPlayerId: playerId, yourSymbol: p.symbol, activePlayerId: existing.players[existing.activeIndex].playerId, expiresAt: existing.expiresAt });
        const other = existing.players.find(x => x.playerId !== playerId);
        if (other) io.to(other.socketId).emit('opponent_reconnected', { matchId: existing.id, playerId });
        return;
      }
    }

    // put into waiting queue (avoid duplicates)
    if (!waitingQueue.find(w => w.playerId === playerId)) {
      waitingQueue.push({ playerId, socketId: socket.id, username, queuedAt: Date.now() });
      socket.emit('waiting', { msg: 'added to queue', playerId });
      // set timeout: after MATCH_SEARCH_TIMEOUT_MS, let client handle (client will offer vs CPU)
      tryAutoMatch();
    } else {
      socket.emit('waiting', { msg: 'already in queue', playerId });
    }
  });

  // Create private room for friend (4-digit code)
  socket.on('create_room', ({ playerId, username } = {}) => {
    if (!playerId) return socket.emit('error_msg', { msg: 'missing playerId' });
    const code = makeRoomCode();
    const matchId = makeId('match');
    const room = 'room_' + matchId;
    // create match placeholder (host waits)
    const p = { playerId, socketId: socket.id, username: username || ('Player_' + playerId.slice(-4)), symbol: 'X' };
    const match = {
      id: matchId, room,
      players: [p], board: Array(9).fill(''),
      activeIndex: 0, history: [], expiresAt: null, turnTimer: null, disconnectTimers: {}
    };
    matches[matchId] = match;
    rooms[code] = { hostPlayerId: playerId, matchId, createdAt: Date.now() };
    try { socket.join(room); } catch(e){}
    socket.emit('room_created', { code, matchId, room, yourPlayerId: playerId, yourSymbol: 'X' });
  });

  // Join private room by code
  socket.on('join_room', ({ code, playerId, username } = {}) => {
    const roomEntry = rooms[code];
    if (!roomEntry) return socket.emit('error_msg', { msg: 'Room not found' });
    const match = matches[roomEntry.matchId];
    if (!match) return socket.emit('error_msg', { msg: 'Match disappeared' });

    const other = match.players[0];
    const newPlayer = { playerId, socketId: socket.id, username: username || ('Player_' + playerId.slice(-4)), symbol: 'O' };
    match.players.push(newPlayer);
    try { socket.join(match.room); } catch(e){}
    // notify both
    io.to(other.socketId).emit('match_found', { matchId: match.id, room: match.room, opponent: newPlayer.username, yourPlayerId: other.playerId, yourSymbol: other.symbol });
    io.to(newPlayer.socketId).emit('match_found', { matchId: match.id, room: match.room, opponent: other.username, yourPlayerId: newPlayer.playerId, yourSymbol: newPlayer.symbol });
    io.to(match.room).emit('match_start', { matchId: match.id, board: match.board, players: match.players.map(p=>({ playerId:p.playerId, username:p.username, symbol:p.symbol })) });
    startTurnTimer(match.id);
    // remove room code so it can't be reused
    delete rooms[code];
  });

  // handle move
  socket.on('make_move', ({ matchId, playerId, cell } = {}) => {
    const match = matches[matchId];
    if (!match) return socket.emit('error_msg', { msg: 'Match not found' });
    const idx = match.players.findIndex(p => p.playerId === playerId);
    if (idx === -1) return socket.emit('error_msg', { msg: 'You are not in match' });
    if (match.activeIndex !== idx) return socket.emit('error_msg', { msg: 'Not your turn' });
    if (typeof cell !== 'number' || cell < 0 || cell > 8) return socket.emit('error_msg', { msg: 'Invalid cell' });
    if (match.board[cell]) return socket.emit('error_msg', { msg: 'Cell taken' });

    const symbol = match.players[idx].symbol;
    match.board[cell] = symbol;
    match.history.push({ type: 'move', playerId, symbol, cell, ts: Date.now() });

    if (match.turnTimer) clearTimeout(match.turnTimer); match.turnTimer = null; match.expiresAt = null;

    const res = checkGameEnd(match.board);
    if (res.over) {
      io.to(match.room).emit('match_end', { matchId, board: match.board, winnerSymbol: res.winner, reason: res.winner ? 'win' : 'draw', winningLine: res.line || null });
      cleanupMatch(matchId);
      return;
    }

    match.activeIndex = 1 - match.activeIndex;
    io.to(match.room).emit('move_made', { matchId, board: match.board, byPlayerId: playerId, bySymbol: symbol, nextActivePlayerId: match.players[match.activeIndex].playerId });
    startTurnTimer(matchId);
  });

  // leave voluntarily
  socket.on('leave_match', ({ matchId, playerId } = {}) => {
    const match = matches[matchId];
    if (!match) return;
    const other = match.players.find(p => p.playerId !== playerId);
    io.to(match.room).emit('match_end', { matchId, board: match.board, winnerSymbol: other ? other.symbol : null, reason: 'left' });
    cleanupMatch(matchId);
  });

  // mute and emoji forwarding
  socket.on('mute_status', ({ room, playerId, muted } = {}) => {
    io.to(room).emit('mute_status', { playerId, muted });
  });
  socket.on('emoji', ({ room, playerId, emoji } = {}) => {
    io.to(room).emit('emoji', { playerId, emoji });
  });

  // voice signaling relay
  socket.on('voice_offer', ({ room, offer } = {}) => { io.to(room).emit('voice_offer', { offer, from: socket.id }); });
  socket.on('voice_answer', ({ room, answer } = {}) => { io.to(room).emit('voice_answer', { answer, from: socket.id }); });
  socket.on('voice_candidate', ({ room, candidate } = {}) => { io.to(room).emit('voice_candidate', { candidate, from: socket.id }); });

  // reconnect token (simple ack)
  socket.on('reconnect_token', ({ token, playerId } = {}) => {
    socket.emit('reconnect_ack', { ok: true, token, playerId });
  });

  // disconnect handling
  socket.on('disconnect', reason => {
    console.log('[disconnect]', socket.id, reason);
    // update players map
    const entry = Object.entries(players).find(([,v]) => v.socketId === socket.id);
    if (!entry) return;
    const [playerId] = entry;
    players[playerId].lastSeen = Date.now();
    // remove from waiting
    waitingQueue = waitingQueue.filter(w => w.playerId !== playerId);
    // if in match, start disconnect timer
    const match = findMatchByPlayer(playerId);
    if (match) {
      match.disconnected = match.disconnected || {};
      match.disconnected[playerId] = Date.now();
      const other = match.players.find(p => p.playerId !== playerId);
      if (other) io.to(other.socketId).emit('opponent_disconnected', { matchId: match.id, playerId });
      const tid = setTimeout(() => {
        if (match && match.disconnected && match.disconnected[playerId]) {
          const winner = match.players.find(p => p.playerId !== playerId);
          io.to(match.room).emit('match_end', { matchId: match.id, board: match.board, winnerSymbol: winner ? winner.symbol : null, reason: 'disconnect_timeout' });
          cleanupMatch(match.id);
        }
      }, DISCONNECT_GRACE_MS);
      match.disconnectTimers = match.disconnectTimers || {};
      match.disconnectTimers[playerId] = tid;
    }
  });

});

server.listen(PORT, () => console.log('Server listening on', PORT));
