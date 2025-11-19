// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // change in production to your client origin
    methods: ['GET','POST']
  }
});

const PORT = process.env.PORT || 10000;
const TURN_TIME_MS = 10 * 1000; // 10 seconds

// serve static client from /public if present
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

let waiting = []; // array of { socketId, username, joinedAt }
let matches = {}; // matchId -> match object

function generateMatchId() {
  return 'm_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

io.on('connection', socket => {
  console.log('[socket connect]', socket.id);

  socket.on('join_lobby', ({ username } = {}) => {
    username = (username && String(username).slice(0,30)) || ('Anon_' + socket.id.slice(0,5));
    socket.data.username = username;
    socket.emit('lobby_joined', { socketId: socket.id, username });

    // add to waiting if not present
    if (!waiting.find(w => w.socketId === socket.id)) {
      waiting.push({ socketId: socket.id, username, joinedAt: Date.now() });
      socket.emit('waiting', { msg: 'added to queue' });
      tryMatch();
    }
  });

  socket.on('leave_lobby', () => {
    waiting = waiting.filter(w => w.socketId !== socket.id);
    socket.emit('left_lobby');
  });

  socket.on('make_move', ({ matchId, move } = {}) => {
    const match = matches[matchId];
    if (!match) return socket.emit('error_msg', { msg: 'Match not found' });
    // validate player
    const playerIndex = match.players.indexOf(socket.id);
    if (playerIndex === -1) return socket.emit('error_msg', { msg: 'You are not in this match' });

    // only active player may move
    if (match.activeIndex !== playerIndex) return socket.emit('error_msg', { msg: 'Not your turn' });

    // Basic validation: move should be { cell: 0..8 } and cell empty
    if (!move || typeof move.cell !== 'number' || move.cell < 0 || move.cell > 8) {
      return socket.emit('error_msg', { msg: 'Invalid move format' });
    }
    if (match.board[move.cell]) return socket.emit('error_msg', { msg: 'Cell already taken' });

    // apply move
    const symbol = playerIndex === 0 ? 'X' : 'O';
    match.board[move.cell] = symbol;
    match.history.push({ by: socket.id, symbol, cell: move.cell, ts: Date.now() });

    // check win/draw
    const result = checkGameEnd(match.board);
    clearTimeout(match.timerId);

    if (result.isOver) {
      // notify both players
      io.to(match.players[0]).to(match.players[1]).emit('match_end', {
        matchId, board: match.board, winner: result.winner, reason: result.reason
      });
      cleanupMatch(matchId);
      return;
    }

    // switch turn
    match.activeIndex = 1 - match.activeIndex;
    startTurnTimer(matchId);
    io.to(match.players[0]).to(match.players[1]).emit('move_made', {
      matchId, board: match.board, move: { cell: move.cell, symbol }, nextActive: match.players[match.activeIndex]
    });
  });

  socket.on('reconnect_match', ({ matchId } = {}) => {
    const match = matches[matchId];
    if (!match) return socket.emit('error_msg', { msg: 'No such match' });
    // if socket id was replaced, we won't auto-reassign; this route is for clients that kept same id.
    socket.join(matchId);
    socket.emit('reconnected', { matchId, board: match.board, active: match.players[match.activeIndex] });
  });

  socket.on('disconnect', reason => {
    console.log('[disconnect]', socket.id, reason);
    // remove from waiting
    waiting = waiting.filter(w => w.socketId !== socket.id);

    // if in match, mark disconnected and notify opponent
    Object.entries(matches).forEach(([matchId, match]) => {
      const idx = match.players.indexOf(socket.id);
      if (idx !== -1) {
        match.disconnected = match.disconnected || {};
        match.disconnected[socket.id] = Date.now();
        const other = match.players.find(id => id !== socket.id);
        if (other) io.to(other).emit('opponent_disconnected', { matchId });

        // set grace for reconnection
        setTimeout(() => {
          // if still disconnected, treat as loss
          if (match.disconnected && match.disconnected[socket.id]) {
            io.to(other).emit('match_end', { matchId, winner: other, reason: 'disconnect' });
            cleanupMatch(matchId);
          }
        }, 10 * 1000); // 10s grace
      }
    });
  });
});

function tryMatch() {
  while (waiting.length >= 2) {
    const p1 = waiting.shift();
    const p2 = waiting.shift();
    const matchId = generateMatchId();
    matches[matchId] = {
      id: matchId,
      players: [p1.socketId, p2.socketId],
      usernames: [p1.username, p2.username],
      board: Array(9).fill(null),
      activeIndex: Math.round(Math.random()), // random starter
      history: [],
      timerId: null,
      createdAt: Date.now(),
      disconnected: {}
    };

    // notify players
    io.to(p1.socketId).emit('match_found', { matchId, opponent: p2.username, yourSymbol: matches[matchId].activeIndex === 0 ? 'X' : 'O' });
    io.to(p2.socketId).emit('match_found', { matchId, opponent: p1.username, yourSymbol: matches[matchId].activeIndex === 1 ? 'X' : 'O' });

    // start match
    startTurnTimer(matchId);
    io.to(p1.socketId).to(p2.socketId).emit('match_start', { matchId });
  }
}

function startTurnTimer(matchId) {
  const match = matches[matchId];
  if (!match) return;
  if (match.timerId) clearTimeout(match.timerId);

  const activeSocketId = match.players[match.activeIndex];
  const expiresAt = Date.now() + TURN_TIME_MS;

  io.to(match.players[0]).to(match.players[1]).emit('start_turn', {
    matchId, activePlayerId: activeSocketId, expiresAt
  });

  match.timerId = setTimeout(() => {
    // double-check if still same active (no move arrived)
    // force pass logic
    match.history.push({ by: activeSocketId, symbol: null, cell: null, ts: Date.now(), reason: 'timeout' });
    match.activeIndex = 1 - match.activeIndex;

    // notify both
    io.to(match.players[0]).to(match.players[1]).emit('force_pass', { matchId, timedOutPlayer: activeSocketId, nextActive: match.players[match.activeIndex] });

    // check for any end condition? (not needed for O/X)
    startTurnTimer(matchId);
  }, TURN_TIME_MS + 50);
}

function cleanupMatch(matchId) {
  const m = matches[matchId];
  if (!m) return;
  if (m.timerId) clearTimeout(m.timerId);
  delete matches[matchId];
}

// basic tic-tac-toe check
function checkGameEnd(board) {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return { isOver: true, winner: board[a], reason: 'win', line: [a,b,c] };
    }
  }
  if (board.every(cell => cell !== null)) {
    return { isOver: true, winner: null, reason: 'draw' };
  }
  return { isOver: false };
}

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
