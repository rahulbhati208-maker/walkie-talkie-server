// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwt';

// --- MySQL pool ---
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/* -------------------- Helpers -------------------- */
async function findUserByEmail(email){ 
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]); 
  return rows[0]; 
}
async function getWalletByUserId(userId){
  const [rows] = await pool.query('SELECT * FROM wallets WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0];
}
async function createWalletForUser(userId){
  return pool.query('INSERT INTO wallets (user_id, balance) VALUES (?, ?)', [userId, 0]);
}
async function addLog({ user_id, amount, type, from_email, to_email, reason, previous_balance, new_balance }){
  return pool.query(
    `INSERT INTO wallet_logs (user_id, amount, type, from_email, to_email, reason, previous_balance, new_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [user_id, amount, type, from_email, to_email, reason, previous_balance, new_balance]
  );
}
function authMiddleware(req, res, next){
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ success:false, message:'No token' });
  const parts = auth.split(' ');
  if (parts.length !==2) return res.status(401).json({ success:false, message:'Bad token' });
  try {
    const payload = jwt.verify(parts[1], JWT_SECRET);
    req.user = payload;
    return next();
  } catch(e){
    return res.status(401).json({ success:false, message:'Invalid token' });
  }
}

/* -------------------- Routes -------------------- */
app.get('/api/ping', (req,res)=> res.json({ ok:true, ts:Date.now() }));

// register (owner first-time)
app.post('/api/register', async (req,res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success:false, message:'missing' });
    const existing = await findUserByEmail(email);
    if (existing) return res.status(400).json({ success:false, message:'email exists' });
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query('INSERT INTO users (name,email,password,role) VALUES (?, ?, ?, ?)', [name,email,hash,role || 'owner']);
    const userId = r.insertId;
    await createWalletForUser(userId);
    return res.json({ success:true, message:'user created' });
  } catch(err){
    console.error(err); res.status(500).json({ success:false, message:'server error' });
  }
});

// login
app.post('/api/login', async (req,res) => {
  try {
    const { email, password } = req.body;
    const user = await findUserByEmail(email);
    if (!user) return res.status(400).json({ success:false, message:'invalid credentials' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ success:false, message:'invalid credentials' });
    const wallet = await getWalletByUserId(user.id);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ success:true, data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, balance: wallet ? wallet.balance : 0 } } });
  } catch(err){ console.error(err); res.status(500).json({ success:false, message:'server error' }); }
});

// create-admin (owner only)
app.post('/api/create-admin', authMiddleware, async (req,res) => {
  try {
    if (req.user.role !== 'owner') return res.status(403).json({ success:false, message:'forbidden' });
    const { name, email, password, created_by } = req.body;
    if (!name||!email||!password) return res.status(400).json({ success:false, message:'missing' });
    const existing = await findUserByEmail(email);
    if (existing) return res.status(400).json({ success:false, message:'email exists' });
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query('INSERT INTO users (name,email,password,role,created_by) VALUES (?,?,?,?,?)', [name,email,hash,'admin', created_by || req.user.email]);
    await createWalletForUser(r.insertId);
    io.emit('user_created', { email, role:'admin' });
    return res.json({ success:true, message:'admin created' });
  } catch(err){ console.error(err); res.status(500).json({ success:false, message:'server error' }); }
});

// create-user (admin or owner)
app.post('/api/create-user', authMiddleware, async (req,res) => {
  try {
    if (!(req.user.role === 'admin' || req.user.role === 'owner')) return res.status(403).json({ success:false, message:'forbidden' });
    const { name, email, password, created_by } = req.body;
    if (!name||!email||!password) return res.status(400).json({ success:false, message:'missing' });
    const existing = await findUserByEmail(email);
    if (existing) return res.status(400).json({ success:false, message:'email exists' });
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query('INSERT INTO users (name,email,password,role,created_by) VALUES (?,?,?,?,?)', [name,email,hash,'user', created_by || req.user.email]);
    await createWalletForUser(r.insertId);
    io.emit('user_created', { email, role:'user', created_by: req.user.email });
    return res.json({ success:true, message:'user created' });
  } catch(err){ console.error(err); res.status(500).json({ success:false, message:'server error' }); }
});

// wallet credit
app.post('/api/wallet/credit', authMiddleware, async (req,res) => {
  try {
    const { fromEmail, toEmail, amount, reason } = req.body;
    if (!fromEmail || !toEmail || !amount) return res.status(400).json({ success:false, message:'missing' });
    // find users:
    const fromUser = await findUserByEmail(fromEmail);
    const toUser = await findUserByEmail(toEmail);
    if (!fromUser || !toUser) return res.status(404).json({ success:false, message:'user not found' });
    // check permission: owner can give to admin, admin can give to user
    if (fromUser.email !== req.user.email && req.user.role !== 'owner') {
      // allow only if token user equals fromEmail OR owner
      return res.status(403).json({ success:false, message:'forbidden sender' });
    }
    // adjust balances using transaction
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [fromWalletRows] = await conn.query('SELECT * FROM wallets WHERE user_id = ? FOR UPDATE', [fromUser.id]);
      const [toWalletRows] = await conn.query('SELECT * FROM wallets WHERE user_id = ? FOR UPDATE', [toUser.id]);
      if (!fromWalletRows.length || !toWalletRows.length) { await conn.rollback(); return res.status(500).json({ success:false, message:'wallet missing' }); }
      const fromWallet = fromWalletRows[0];
      const toWallet = toWalletRows[0];
      if (Number(fromWallet.balance) < Number(amount)) { await conn.rollback(); return res.status(400).json({ success:false, message:'insufficient balance' }); }
      const prevFrom = Number(fromWallet.balance);
      const prevTo = Number(toWallet.balance);
      const newFrom = prevFrom - Number(amount);
      const newTo = prevTo + Number(amount);
      await conn.query('UPDATE wallets SET balance = ? WHERE id = ?', [newFrom, fromWallet.id]);
      await conn.query('UPDATE wallets SET balance = ? WHERE id = ?', [newTo, toWallet.id]);
      // insert logs
      await conn.query('INSERT INTO wallet_logs (user_id, amount, type, from_email, to_email, reason, previous_balance, new_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [fromUser.id, amount, 'debit', fromEmail, toEmail, reason || 'credit', prevFrom, newFrom]);
      await conn.query('INSERT INTO wallet_logs (user_id, amount, type, from_email, to_email, reason, previous_balance, new_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [toUser.id, amount, 'credit', fromEmail, toEmail, reason || 'credit', prevTo, newTo]);
      await conn.commit();
      // emit socket events
      io.emit('wallet_update', { userEmail: fromUser.email, balance: newFrom });
      io.emit('wallet_update', { userEmail: toUser.email, balance: newTo });
      const tx = { from: fromUser.email, to: toUser.email, amount, reason };
      io.emit('transaction', tx);
      return res.json({ success:true, message:'credited', balance: newFrom, transaction: tx });
    } catch(e){
      await conn.rollback(); console.error(e); return res.status(500).json({ success:false, message:'tx failed' });
    } finally { conn.release(); }
  } catch(err){ console.error(err); res.status(500).json({ success:false, message:'server error' }); }
});

// wallet recover (take back)
app.post('/api/wallet/recover', authMiddleware, async (req,res) => {
  try {
    const { byEmail, fromEmail, amount, reason } = req.body;
    if (!byEmail || !fromEmail || !amount) return res.status(400).json({ success:false, message:'missing' });
    const byUser = await findUserByEmail(byEmail);
    const fromUser = await findUserByEmail(fromEmail);
    if (!byUser || !fromUser) return res.status(404).json({ success:false, message:'user not found' });
    // Only owner can recover from admins; admin can recover from users. Also check that byUser matches req.user.email
    if (req.user.email !== byUser.email) return res.status(403).json({ success:false, message:'forbidden' });
    if (byUser.role === 'owner' && fromUser.role !== 'admin' && fromUser.role !== 'user') return res.status(403).json({ success:false, message:'invalid recover target' });
    if (byUser.role === 'admin' && fromUser.role !== 'user') return res.status(403).json({ success:false, message:'admins can only recover from users' });
    // do transfer reversed: fromUser -> byUser (debit from fromUser, credit to byUser)
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [fromWalletRows] = await conn.query('SELECT * FROM wallets WHERE user_id = ? FOR UPDATE', [fromUser.id]);
      const [toWalletRows] = await conn.query('SELECT * FROM wallets WHERE user_id = ? FOR UPDATE', [byUser.id]);
      if (!fromWalletRows.length || !toWalletRows.length) { await conn.rollback(); return res.status(500).json({ success:false, message:'wallet missing' }); }
      const fromWallet = fromWalletRows[0], toWallet = toWalletRows[0];
      if (Number(fromWallet.balance) < Number(amount)) { await conn.rollback(); return res.status(400).json({ success:false, message:'insufficient balance on target' }); }
      const prevFrom = Number(fromWallet.balance), prevTo = Number(toWallet.balance);
      const newFrom = prevFrom - Number(amount), newTo = prevTo + Number(amount);
      await conn.query('UPDATE wallets SET balance = ? WHERE id = ?', [newFrom, fromWallet.id]);
      await conn.query('UPDATE wallets SET balance = ? WHERE id = ?', [newTo, toWallet.id]);
      await conn.query('INSERT INTO wallet_logs (user_id, amount, type, from_email, to_email, reason, previous_balance, new_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [fromUser.id, amount, 'debit', fromEmail, byEmail, reason || 'recover', prevFrom, newFrom]);
      await conn.query('INSERT INTO wallet_logs (user_id, amount, type, from_email, to_email, reason, previous_balance, new_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [byUser.id, amount, 'credit', fromEmail, byEmail, reason || 'recover', prevTo, newTo]);
      await conn.commit();
      io.emit('wallet_update', { userEmail: fromUser.email, balance: newFrom });
      io.emit('wallet_update', { userEmail: byUser.email, balance: newTo });
      io.emit('transaction', { from: fromUser.email, to: byUser.email, amount, reason: 'recover' });
      return res.json({ success:true, message:'recovered', balance: newTo });
    } catch(e){
      await conn.rollback(); console.error(e); return res.status(500).json({ success:false, message:'tx failed' });
    } finally { conn.release(); }
  } catch(err){ console.error(err); res.status(500).json({ success:false, message:'server error' }); }
});

// wallet get
app.get('/api/wallet/:id', authMiddleware, async (req,res) => {
  try {
    const id = req.params.id;
    // allow only same user or admin/owner view? For simplicity, owner/admin can view everyone; users view their own
    if (req.user.id != id && req.user.role === 'user') return res.status(403).json({ success:false, message:'forbidden' });
    const [rows] = await pool.query('SELECT w.* , u.email FROM wallets w JOIN users u ON u.id = w.user_id WHERE u.id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'not found' });
    return res.json({ success:true, data: { balance: rows[0].balance } });
  } catch(err){ console.error(err); res.status(500).json({ success:false, message:'server error' }); }
});

// transactions
app.get('/api/transactions/:id', authMiddleware, async (req,res) => {
  try {
    const id = req.params.id;
    if (req.user.id != id && req.user.role === 'user') return res.status(403).json({ success:false, message:'forbidden' });
    const [rows] = await pool.query('SELECT wl.*, u.email as user_email FROM wallet_logs wl JOIN users u ON u.id = wl.user_id WHERE u.id = ? ORDER BY wl.created_at DESC LIMIT 500', [id]);
    return res.json({ success:true, data: rows });
  } catch(err){ console.error(err); res.status(500).json({ success:false, message:'server error' }); }
});

// play (Rule A)
app.post('/api/play', authMiddleware, async (req,res) => {
  try {
    const { userEmail, bet } = req.body;
    if (!userEmail || !bet) return res.status(400).json({ success:false, message:'missing' });
    if (req.user.email !== userEmail && req.user.role === 'user') return res.status(403).json({ success:false, message:'forbidden' });
    const user = await findUserByEmail(userEmail);
    if (!user) return res.status(404).json({ success:false, message:'user not found' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [walletRows] = await conn.query('SELECT * FROM wallets WHERE user_id = ? FOR UPDATE', [user.id]);
      if (!walletRows.length) { await conn.rollback(); return res.status(500).json({ success:false, message:'wallet missing' }); }
      const wallet = walletRows[0];
      if (Number(wallet.balance) < Number(bet)) { await conn.rollback(); return res.status(400).json({ success:false, message:'insufficient balance' }); }
      // simulate coin flip
      const win = Math.random() < 0.5;
      let newBalance = Number(wallet.balance);
      const prev = newBalance;
      if (win) {
        // Rule A: user gets profit equal to bet (net +bet)
        newBalance = newBalance + Number(bet);
        await conn.query('UPDATE wallets SET balance = ? WHERE id = ?', [newBalance, wallet.id]);
        await conn.query('INSERT INTO wallet_logs (user_id, amount, type, from_email, to_email, reason, previous_balance, new_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [user.id, bet, 'win', 'system', user.email, 'play_win', prev, newBalance]);
      } else {
        // lose: remove bet
        newBalance = newBalance - Number(bet);
        await conn.query('UPDATE wallets SET balance = ? WHERE id = ?', [newBalance, wallet.id]);
        await conn.query('INSERT INTO wallet_logs (user_id, amount, type, from_email, to_email, reason, previous_balance, new_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [user.id, bet, 'lose', user.email, 'system', 'play_lose', prev, newBalance]);
      }
      await conn.query('INSERT INTO matches (user_id, bet_amount, win, payout) VALUES (?, ?, ?, ?)', [user.id, bet, win?1:0, win? bet: 0]);
      await conn.commit();
      io.emit('play_result', { userEmail: user.email, win, amount: bet, balance: newBalance });
      io.emit('wallet_update', { userEmail: user.email, balance: newBalance });
      return res.json({ success:true, result: { win, balance: newBalance }, transaction: { userEmail: user.email, win, amount: bet } });
    } catch(e){
      await conn.rollback(); console.error(e); return res.status(500).json({ success:false, message:'tx failed' });
    } finally { conn.release(); }
  } catch(err){ console.error(err); res.status(500).json({ success:false, message:'server error' }); }
});

/* -------------------- SOCKET.IO -------------------- */
io.on('connection', socket => {
  console.log('socket connected', socket.id);
  socket.on('client_test', data => {
    console.log('client_test', data);
    socket.emit('server_response', { ok:true, ts:Date.now() });
  });
});

/* -------------------- Start -------------------- */
server.listen(PORT, () => {
  console.log('Server listening on port', PORT);
});
