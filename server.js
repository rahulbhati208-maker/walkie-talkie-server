// server.js (CommonJS)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

const PORT = process.env.PORT || 3000;
const TURN_TIME_MS = 20 * 1000; // 20 seconds per turn
const DISCONNECT_GRACE_MS = 40 * 1000; // 40 seconds to reconnect

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

/*
 Data structures:

 waitingQueue: array of { playerId, username, socketId }
 players: map playerId -> { socketId, username, lastSeen }
 matches: map matchId -> {
   id, players: [ { playerId, socketId, username, symbol } , ... ],
   board: [null..8], activeIndex, history, timerId, expiresAt,
   disconnectTimers: { playerId: timeoutId }, createdAt
 }
*/
let waitingQueue = [];
let players = {}; // playerId -> { socketId, username, lastSeen }
let matches = {}; // matchId -> match object

function generateMatchId() {
  return 'm_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

function checkGameEnd(board) {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return { isOver: true, winnerSymbol: board[a], reason: 'win', line: [a,b,c] };
    }
  }
  if (board.every(cell => cell !== null)) return { isOver: true, winnerSymbol: null, reason: 'draw' };
  return { isOver: false };
}

/* Starts the turn timer for a match */
function startTurnTimer(matchId) {
  const match = matches[matchId];
  if (!match) return;
  if (match.timerId) clearTimeout(match.timerId);

  const active = match.players[match.activeIndex];
  const expiresAt = Date.now() + TURN_TIME_MS;
  match.expiresAt = expiresAt;

  // broadcast start_turn with active player's playerId
  io.to(match.room).emit('start_turn', {
    matchId,
    activePlayerId: active.playerId,
    expiresAt
  });

  match.timerId = setTimeout(() => {
    // If match no longer exists skip
    if (!matches[matchId]) return;

    // store timeout in history and force pass if nobody moved
    match.history.push({ type: 'timeout', playerId: active.playerId, ts: Date.now() });

    // switch active
    match.activeIndex = 1 - match.activeIndex;

    // notify both
    io.to(match.room).emit('force_pass', {
      matchId,
      timedOutPlayerId: active.playerId,
      nextActivePlayerId: match.players[match.activeIndex].playerId
    });

    // start next timer
    startTurnTimer(matchId);
  }, TURN_TIME_MS + 50);
}

/* Cleanup match: clear timers and delete */
function cleanupMatch(matchId) {
  const m = matches[matchId];
  if (!m) return;
  if (m.timerId) clearTimeout(m.timerId);
  if (m.disconnectTimers) {
    Object.values(m.disconnectTimers).forEach(t => clearTimeout(t));
  }
  delete matches[matchId];
}

/* Try to match waiting players */
function tryMatch() {
  while (waitingQueue.length >= 2) {
    const a = waitingQueue.shift();
    const b = waitingQueue.shift();

    // Basic check they are not same player
    if (a.playerId === b.playerId) {
      // same player queued twice (unlikely) - push back next
      waitingQueue.push(b);
      continue;
    }

    const matchId = generateMatchId();
    const room = 'room_' + matchId;
    const firstIndex = Math.round(Math.random()); // who starts (0/1)

    const match = {
      id: matchId,
      room,
      players: [
        { playerId: a.playerId, socketId: a.socketId, username: a.username, symbol: firstIndex === 0 ? 'X' : 'O' },
        { playerId: b.playerId, socketId: b.socketId, username: b.username, symbol: firstIndex === 1 ? 'X' : 'O' }
      ],
      board: Array(9).fill(null),
      activeIndex: firstIndex,
      history: [],
      timerId: null,
      expiresAt: null,
      disconnectTimers: {},
      createdAt: Date.now()
    };

    matches[matchId] = match;

    // join sockets to a named room for easy broadcasting
    try { io.sockets.sockets.get(a.socketId).join(room); } catch(e){}
    try { io.sockets.sockets.get(b.socketId).join(room); } catch(e){}

    // notify each player of match found and their symbol
    io.to(a.socketId).emit('match_found', {
      matchId,
      room,
      opponent: b.username,
      yourPlayerId: a.playerId,
      yourSymbol: match.players[0].playerId === a.playerId ? match.players[0].symbol : match.players[1].symbol
    });
    io.to(b.socketId).emit('match_found', {
      matchId,
      room,
      opponent: a.username,
      yourPlayerId: b.playerId,
      yourSymbol: match.players[0].playerId === b.playerId ? match.players[0].symbol : match.players[1].symbol
    });

    // send match_start
    io.to(room).emit('match_start', { matchId, board: match.board, players: match.players.map(p => ({ playerId: p.playerId, username: p.username, symbol: p.symbol })) });

    // start the first turn timer
    startTurnTimer(matchId);
  }
}

/* Find match by playerId */
function findMatchByPlayer(playerId) {
  return Object.values(matches).find(m => m.players.some(p => p.playerId === playerId));
}

/* Helper to get player's object in match by playerId */
function getPlayerInMatch(match, playerId) {
  return match.players.find(p => p.playerId === playerId);
}

/* When socket connects */
io.on('connection', socket => {
  console.log('[socket connect]', socket.id);

  socket.on('join_lobby', ({ username, playerId } = {}) => {
    // ensure playerId
    if (!playerId) playerId = uuidv4(); // fallback (client should send it)
    username = (username && String(username).slice(0,30)) || ('Anon_' + playerId.slice(0,5));

    // store player mapping
    players[playerId] = { socketId: socket.id, username, lastSeen: Date.now() };

    // If player already in match (reconnect), rebind socket
    const existingMatch = findMatchByPlayer(playerId);
    if (existingMatch) {
      // Replace socketId in match
      const p = getPlayerInMatch(existingMatch, playerId);
      if (p) {
        p.socketId = socket.id;
        // join room
        try { socket.join(existingMatch.room); } catch(e){}

        // Cancel any disconnect timer for this player
        if (existingMatch.disconnectTimers && existingMatch.disconnectTimers[playerId]) {
          clearTimeout(existingMatch.disconnectTimers[playerId]);
          delete existingMatch.disconnectTimers[playerId];
        }

        players[playerId].lastSeen = Date.now();

        // Send reconnected data
        socket.emit('reconnected', {
          matchId: existingMatch.id,
          board: existingMatch.board,
          yourPlayerId: playerId,
          yourSymbol: p.symbol,
          activePlayerId: existingMatch.players[existingMatch.activeIndex].playerId,
          expiresAt: existingMatch.expiresAt
        });

        // Notify opponent
        const other = existingMatch.players.find(x => x.playerId !== playerId);
        if (other) {
          io.to(other.socketId).emit('opponent_reconnected', { matchId: existingMatch.id, playerId });
        }
        return;
      }
    }

    // Not in a match: add to waiting queue (but avoid duplicates)
    if (!waitingQueue.find(w => w.playerId === playerId)) {
      waitingQueue.push({ playerId, socketId: socket.id, username });
      socket.emit('waiting', { msg: 'added to queue', playerId });
      tryMatch();
    } else {
      socket.emit('waiting', { msg: 'already in queue', playerId });
    }
  });

  /* Player emits make_move */
  socket.on('make_move', ({ matchId, playerId, cell } = {}) => {
    const match = matches[matchId];
    if (!match) return socket.emit('error_msg', { msg: 'Match not found' });

    const idx = match.players.findIndex(p => p.playerId === playerId);
    if (idx === -1) return socket.emit('error_msg', { msg: 'You are not a participant' });

    // Check it's this player's turn
    if (match.activeIndex !== idx) return socket.emit('error_msg', { msg: 'Not your turn' });

    // Validate cell
    if (typeof cell !== 'number' || cell < 0 || cell > 8) return socket.emit('error_msg', { msg: 'Invalid cell' });
    if (match.board[cell]) return socket.emit('error_msg', { msg: 'Cell occupied' });

    // Apply move
    const symbol = match.players[idx].symbol;
    match.board[cell] = symbol;
    match.history.push({ type: 'move', playerId, symbol, cell, ts: Date.now() });

    // Clear current turn timer, check win/draw
    if (match.timerId) {
      clearTimeout(match.timerId);
      match.timerId = null;
      match.expiresAt = null;
    }

    const result = checkGameEnd(match.board);
    if (result.isOver) {
      // Broadcast end
      io.to(match.room).emit('match_end', {
        matchId,
        board: match.board,
        winnerSymbol: result.winnerSymbol,
        reason: result.reason,
        winningLine: result.line || null
      });
      cleanupMatch(matchId);
      return;
    }

    // Switch turn, notify move, start new timer
    match.activeIndex = 1 - match.activeIndex;
    io.to(match.room).emit('move_made', {
      matchId,
      board: match.board,
      byPlayerId: playerId,
      bySymbol: symbol,
      nextActivePlayerId: match.players[match.activeIndex].playerId
    });

    startTurnTimer(matchId);
  });

  /* Player leaves voluntarily */
  socket.on('leave_match', ({ matchId, playerId } = {}) => {
    const match = matches[matchId];
    if (!match) return;
    const idx = match.players.findIndex(p => p.playerId === playerId);
    if (idx === -1) return;
    const other = match.players.find(p => p.playerId !== playerId);
    // declare other winner
    io.to(match.room).emit('match_end', {
      matchId,
      board: match.board,
      winnerSymbol: other ? other.symbol : null,
      reason: 'left'
    });
    cleanupMatch(matchId);
  });

  /* socket disconnect: mark player disconnected and start 40s timer */
  socket.on('disconnect', () => {
    console.log('[disconnect]', socket.id);
    // Update players mapping lastSeen, find which playerId had this socket
    const pEntry = Object.entries(players).find(([,v]) => v.socketId === socket.id);
    if (pEntry) {
      const [playerId] = pEntry;
      players[playerId].lastSeen = Date.now();

      // If player was in waitingQueue remove
      waitingQueue = waitingQueue.filter(w => w.playerId !== playerId);

      // If player was in match, set disconnect timer
      const match = findMatchByPlayer(playerId);
      if (match) {
        // mark disconnected in match
        match.disconnected = match.disconnected || {};
        match.disconnected[playerId] = Date.now();

        // notify opponent
        const other = match.players.find(p => p.playerId !== playerId);
        if (other) {
          io.to(other.socketId).emit('opponent_disconnected', { matchId: match.id, playerId });
        }

        // start disconnect grace timer (40s)
        const t = setTimeout(() => {
          // if still disconnected, declare other winner
          if (match && match.disconnected && match.disconnected[playerId]) {
            const opponent = match.players.find(p => p.playerId !== playerId);
            io.to(match.room).emit('match_end', {
              matchId: match.id,
              board: match.board,
              winnerSymbol: opponent ? opponent.symbol : null,
              reason: 'disconnect_timeout'
            });
            cleanupMatch(match.id);
          }
        }, DISCONNECT_GRACE_MS);

        match.disconnectTimers = match.disconnectTimers || {};
        match.disconnectTimers[playerId] = t;
      }
    }
  });

});

/* start server */
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
