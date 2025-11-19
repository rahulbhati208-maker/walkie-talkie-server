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
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

const PORT = process.env.PORT || 3000;
const TURN_TIME_MS = 20 * 1000; // 20s
const DISCONNECT_GRACE_MS = 40 * 1000; // 40s

// Data stores
let waitingQueue = []; // { playerId, socketId, username }
let players = {}; // playerId -> { socketId, username, lastSeen }
let matches = {}; // matchId -> matchObj

function makeId(prefix='m') { return prefix + '_' + Math.random().toString(36).slice(2,9); }

function checkGameEnd(board) {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return { over:true, winner: board[a], line:[a,b,c] };
  }
  if (board.every(x => x !== null && x !== '')) return { over:true, winner:null, line:null };
  return { over:false };
}

function findMatchByPlayer(playerId) {
  return Object.values(matches).find(m => m.players.some(p=>p.playerId===playerId));
}

// start turn timer (server authoritative)
function startTurnTimer(matchId) {
  const m = matches[matchId]; if (!m) return;
  if (m.turnTimer) clearTimeout(m.turnTimer);

  const active = m.players[m.activeIndex];
  m.expiresAt = Date.now() + TURN_TIME_MS;

  io.to(m.room).emit('start_turn', { matchId, activePlayerId: active.playerId, expiresAt: m.expiresAt });

  m.turnTimer = setTimeout(() => {
    // timeout: force pass
    m.history.push({ type:'timeout', by: active.playerId, ts: Date.now() });
    m.activeIndex = 1 - m.activeIndex;
    io.to(m.room).emit('force_pass', { matchId, timedOutPlayer: active.playerId, nextActive: m.players[m.activeIndex].playerId });
    // if game over conditions? continue
    startTurnTimer(matchId);
  }, TURN_TIME_MS + 60);
}

function cleanupMatch(matchId) {
  const m = matches[matchId];
  if (!m) return;
  if (m.turnTimer) clearTimeout(m.turnTimer);
  if (m.disconnectTimers) { Object.values(m.disconnectTimers).forEach(t=>clearTimeout(t)); }
  delete matches[matchId];
}

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  // Client can send join_lobby with { username, playerId }
  socket.on('join_lobby', ({ username, playerId }={}) => {
    if (!playerId) playerId = 'p_' + Math.random().toString(36).slice(2,10);
    username = (username && String(username).slice(0,30)) || ('Player_' + playerId.slice(-4));
    players[playerId] = { socketId: socket.id, username, lastSeen: Date.now() };
    socket.data.playerId = playerId;

    // If player was in a match (reconnect)
    const existing = findMatchByPlayer(playerId);
    if (existing) {
      // update socket id
      const p = existing.players.find(pp=>pp.playerId===playerId);
      if (p) { p.socketId = socket.id; players[playerId].lastSeen = Date.now(); socket.join(existing.room); 
        // cancel disconnect timer for that player
        if (existing.disconnectTimers && existing.disconnectTimers[playerId]) { clearTimeout(existing.disconnectTimers[playerId]); delete existing.disconnectTimers[playerId]; }
        socket.emit('reconnected', { matchId: existing.id, board: existing.board, yourPlayerId: playerId, yourSymbol: p.symbol, activePlayerId: existing.players[existing.activeIndex].playerId, expiresAt: existing.expiresAt });
        // notify opponent
        const other = existing.players.find(pp=>pp.playerId!==playerId);
        if (other) io.to(other.socketId).emit('opponent_reconnected', { matchId: existing.id, playerId });
        return;
      }
    }

    // else add to waiting queue (avoid duplicate)
    if (!waitingQueue.find(w=>w.playerId===playerId)) {
      waitingQueue.push({ playerId, socketId: socket.id, username });
      socket.emit('waiting', { msg:'added to queue', playerId });
      tryMatch();
    } else {
      socket.emit('waiting', { msg:'already in queue', playerId });
    }
  });

  // attempt matching
  function tryMatch() {
    while (waitingQueue.length >= 2) {
      const a = waitingQueue.shift();
      const b = waitingQueue.shift();
      if (a.playerId === b.playerId) { waitingQueue.push(b); continue; }

      const matchId = makeId('match');
      const room = 'room_' + matchId;
      const first = Math.round(Math.random());
      const playersArr = [
        { playerId: a.playerId, socketId: a.socketId, username: a.username, symbol: first===0?'X':'O' },
        { playerId: b.playerId, socketId: b.socketId, username: b.username, symbol: first===1?'X':'O' }
      ];
      const match = {
        id: matchId,
        room,
        players: playersArr,
        board: Array(9).fill(''),
        activeIndex: first,
        history: [],
        expiresAt: null,
        turnTimer: null,
        disconnectTimers: {}
      };
      matches[matchId] = match;

      // join room
      try { io.sockets.sockets.get(a.socketId).join(room); } catch(e){}
      try { io.sockets.sockets.get(b.socketId).join(room); } catch(e){}

      // notify players
      io.to(a.socketId).emit('match_found', { matchId, room, opponent: b.username, yourPlayerId: a.playerId, yourSymbol: playersArr[0].playerId===a.playerId?playersArr[0].symbol:playersArr[1].symbol });
      io.to(b.socketId).emit('match_found', { matchId, room, opponent: a.username, yourPlayerId: b.playerId, yourSymbol: playersArr[0].playerId===b.playerId?playersArr[0].symbol:playersArr[1].symbol });

      io.to(room).emit('match_start', { matchId, board: match.board, players: match.players.map(p=>({playerId:p.playerId, username:p.username, symbol:p.symbol })) });

      startTurnTimer(matchId);
    }
  }

  // make_move event
  socket.on('make_move', ({ matchId, playerId, cell }={}) => {
    const match = matches[matchId];
    if (!match) return socket.emit('error_msg', { msg:'Match not found' });
    const idx = match.players.findIndex(p=>p.playerId===playerId);
    if (idx === -1) return socket.emit('error_msg',{ msg:'Not participant' });

    if (match.activeIndex !== idx) return socket.emit('error_msg',{ msg:'Not your turn' });
    if (typeof cell !== 'number' || cell<0 || cell>8) return socket.emit('error_msg',{ msg:'Invalid cell' });
    if (match.board[cell]) return socket.emit('error_msg',{ msg:'Cell occupied' });

    const symbol = match.players[idx].symbol;
    match.board[cell] = symbol;
    match.history.push({ type:'move', playerId, symbol, cell, ts:Date.now() });

    // clear turn timer
    if (match.turnTimer) clearTimeout(match.turnTimer); match.turnTimer = null; match.expiresAt = null;

    // check win/draw
    const res = checkGameEnd(match.board);
    if (res.over) {
      io.to(match.room).emit('match_end', { matchId, board: match.board, winnerSymbol: res.winner, reason: res.winner? 'win':'draw', winningLine: res.line||null });
      cleanupMatch(matchId);
      return;
    }

    // switch turn
    match.activeIndex = 1 - match.activeIndex;
    io.to(match.room).emit('move_made', { matchId, board: match.board, byPlayerId: playerId, bySymbol: symbol, nextActivePlayerId: match.players[match.activeIndex].playerId });
    startTurnTimer(matchId);
  });

  // leave match voluntarily
  socket.on('leave_match', ({ matchId, playerId }={}) => {
    const match = matches[matchId];
    if (!match) return;
    const other = match.players.find(p=>p.playerId!==playerId);
    io.to(match.room).emit('match_end', { matchId, board: match.board, winnerSymbol: other?other.symbol:null, reason:'left' });
    cleanupMatch(matchId);
  });

  // disconnect handling
  socket.on('disconnect', reason => {
    console.log('disconnect', socket.id, reason);
    // find playerId
    const pEntry = Object.entries(players).find(([,v])=>v.socketId===socket.id);
    if (!pEntry) return;
    const [playerId] = pEntry;
    players[playerId].lastSeen = Date.now();

    // remove from waiting
    waitingQueue = waitingQueue.filter(w=>w.playerId!==playerId);

    // if in match, start disconnect timer
    const match = findMatchByPlayer(playerId);
    if (match) {
      match.disconnected = match.disconnected || {};
      match.disconnected[playerId] = Date.now();
      const other = match.players.find(p=>p.playerId!==playerId);
      if (other) io.to(other.socketId).emit('opponent_disconnected', { matchId: match.id, playerId });

      // start 40s grace
      const tid = setTimeout(() => {
        if (match && match.disconnected && match.disconnected[playerId]) {
          const winner = match.players.find(p=>p.playerId!==playerId);
          io.to(match.room).emit('match_end', { matchId: match.id, board: match.board, winnerSymbol: winner?winner.symbol:null, reason:'disconnect_timeout' });
          cleanupMatch(match.id);
        }
      }, DISCONNECT_GRACE_MS);
      match.disconnectTimers = match.disconnectTimers || {};
      match.disconnectTimers[playerId] = tid;
    }
  });

  // --- VOICE SIGNALING: relay messages to room peers --- //
  // Frontend will emit voice_offer, voice_answer, voice_candidate with room info
  socket.on('voice_offer', ({ room, offer }) => { io.to(room).emit('voice_offer', { offer, from: socket.id }); });
  socket.on('voice_answer', ({ room, answer }) => { io.to(room).emit('voice_answer', { answer, from: socket.id }); });
  socket.on('voice_candidate', ({ room, candidate }) => { io.to(room).emit('voice_candidate', { candidate, from: socket.id }); });

  // mute status forwarding
  socket.on('mute_status', ({ room, playerId, muted }) => {
    io.to(room).emit('mute_status', { playerId, muted });
  });

  // emoji reaction forwarding
  socket.on('emoji', ({ room, playerId, emoji }) => {
    io.to(room).emit('emoji', { playerId, emoji });
  });

  // small helper for reconnect_token (client may want to rejoin by token)
  socket.on('reconnect_token', ({ token, playerId }={}) => {
    // client can provide token; we don't need complex storage here;
    // but reply with simple ack
    socket.emit('reconnect_ack', { ok:true, token, playerId });
  });

  // expose a debug event
  socket.on('ping_srv', ()=> socket.emit('pong_srv'));
});

server.listen(PORT, ()=> console.log('listening on', PORT));
