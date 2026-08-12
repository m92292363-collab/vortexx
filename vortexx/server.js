const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const db = require('./db');
const { signToken, verifyToken, requireAuth } = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const PUBLIC_FIELDS = `id, username, avatar_color, level, xp, xp_max, wins, games_played, kd, status, status_text, is_bot, last_seen`;

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    avatarColor: row.avatar_color,
    level: row.level,
    xp: row.xp,
    xpMax: row.xp_max,
    wins: row.wins,
    gamesPlayed: row.games_played,
    kd: row.kd,
    status: row.status,
    statusText: row.status_text,
    isBot: !!row.is_bot,
    lastSeen: row.last_seen,
  };
}

// ---------- AUTH ----------
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error: 'username, email, password required' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  if (existing) return res.status(409).json({ error: 'Username or email already taken' });

  const hash = bcrypt.hashSync(password, 10);
  const colors = ['#8b5cf6', '#3b82f6', '#ec4899', '#22d3ee', '#f59e0b', '#10b981'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const info = db.prepare(`INSERT INTO users (username, email, password_hash, avatar_color, status) VALUES (?, ?, ?, ?, 'online')`)
    .run(username, email, hash, color);
  const user = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`).get(info.lastInsertRowid);
  const token = signToken(user);
  res.cookie('vortexx_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const row = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, email);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  db.prepare(`UPDATE users SET status = 'online', last_seen = strftime('%s','now') WHERE id = ?`).run(row.id);
  const token = signToken(row);
  res.cookie('vortexx_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
  const fresh = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`).get(row.id);
  res.json({ token, user: publicUser(fresh) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare(`UPDATE users SET status = 'offline', last_seen = strftime('%s','now') WHERE id = ?`).run(req.userId);
  res.clearCookie('vortexx_token');
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const row = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`).get(req.userId);
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(row) });
});

// ---------- FRIENDS ----------
app.get('/api/friends', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT u.*, f.status as friend_status, f.requester_id
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
    WHERE (f.requester_id = ? OR f.addressee_id = ?)
    ORDER BY u.status = 'online' DESC, u.username ASC
  `).all(req.userId, req.userId, req.userId);

  const friends = rows.filter(r => r.friend_status === 'accepted').map(publicUser);
  const incoming = rows.filter(r => r.friend_status === 'pending' && r.requester_id !== req.userId).map(publicUser);
  const outgoing = rows.filter(r => r.friend_status === 'pending' && r.requester_id === req.userId).map(publicUser);
  res.json({ friends, incoming, outgoing });
});

app.get('/api/friends/search', requireAuth, (req, res) => {
  const q = `%${(req.query.q || '').toString().trim()}%`;
  if (q === '%%') return res.json({ results: [] });
  const rows = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE username LIKE ? AND id != ? LIMIT 20`).all(q, req.userId);
  res.json({ results: rows.map(publicUser) });
});

app.post('/api/friends/request', requireAuth, (req, res) => {
  const { userId } = req.body || {};
  const targetId = Number(userId);
  if (!targetId || targetId === req.userId) return res.status(400).json({ error: 'Invalid target user' });
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const existing = db.prepare(`SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`)
    .get(req.userId, targetId, targetId, req.userId);
  if (existing) return res.status(409).json({ error: 'Friend request already exists' });

  db.prepare(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')`).run(req.userId, targetId);
  io.to(`user:${targetId}`).emit('friend:request', { fromId: req.userId });
  res.json({ ok: true });
});

app.post('/api/friends/accept', requireAuth, (req, res) => {
  const { userId } = req.body || {};
  const requesterId = Number(userId);
  const info = db.prepare(`UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`)
    .run(requesterId, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'No pending request found' });
  io.to(`user:${requesterId}`).emit('friend:accepted', { byId: req.userId });
  res.json({ ok: true });
});

app.post('/api/friends/remove', requireAuth, (req, res) => {
  const { userId } = req.body || {};
  const otherId = Number(userId);
  db.prepare(`DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`)
    .run(req.userId, otherId, otherId, req.userId);
  res.json({ ok: true });
});

// ---------- GAMES & ROOMS ----------
app.get('/api/games', requireAuth, (req, res) => {
  const games = db.prepare('SELECT * FROM games ORDER BY name').all();
  res.json({ games });
});

app.get('/api/rooms', requireAuth, (req, res) => {
  const { gameId, region } = req.query;
  let query = `SELECT r.*, g.name as game_name, g.color as game_color, g.icon as game_icon,
    (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
    FROM rooms r JOIN games g ON g.id = r.game_id WHERE 1=1`;
  const params = [];
  if (gameId) { query += ' AND r.game_id = ?'; params.push(gameId); }
  if (region && region !== 'Any Region') { query += ' AND r.region = ?'; params.push(region); }
  query += ' ORDER BY r.created_at DESC LIMIT 50';
  const rooms = db.prepare(query).all(...params);
  res.json({ rooms });
});

app.get('/api/rooms/mine', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, g.name as game_name, g.color as game_color, g.icon as game_icon,
    (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
    FROM rooms r JOIN games g ON g.id = r.game_id
    JOIN room_members rm ON rm.room_id = r.id
    WHERE rm.user_id = ? ORDER BY r.created_at DESC`).all(req.userId);
  res.json({ rooms: rows });
});

app.post('/api/rooms', requireAuth, (req, res) => {
  const { gameId, name, mode, region, maxSize } = req.body || {};
  if (!gameId || !name) return res.status(400).json({ error: 'gameId and name required' });
  const info = db.prepare(`INSERT INTO rooms (game_id, name, mode, region, max_size, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(gameId, name, mode || 'Squad', region || 'Any Region', maxSize || 4, req.userId);
  db.prepare(`INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)`).run(info.lastInsertRowid, req.userId);
  const room = db.prepare(`SELECT r.*, g.name as game_name, g.color as game_color, g.icon as game_icon FROM rooms r JOIN games g ON g.id=r.game_id WHERE r.id = ?`).get(info.lastInsertRowid);
  io.emit('room:created', room);
  res.json({ room });
});

app.post('/api/rooms/:id/join', requireAuth, (req, res) => {
  const roomId = Number(req.params.id);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const count = db.prepare('SELECT COUNT(*) as c FROM room_members WHERE room_id = ?').get(roomId).c;
  if (count >= room.max_size) return res.status(400).json({ error: 'Room is full' });
  db.prepare(`INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)`).run(roomId, req.userId);
  const newCount = db.prepare('SELECT COUNT(*) as c FROM room_members WHERE room_id = ?').get(roomId).c;
  io.emit('room:updated', { roomId, memberCount: newCount });
  res.json({ ok: true, memberCount: newCount });
});

app.post('/api/rooms/:id/leave', requireAuth, (req, res) => {
  const roomId = Number(req.params.id);
  db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(roomId, req.userId);
  const newCount = db.prepare('SELECT COUNT(*) as c FROM room_members WHERE room_id = ?').get(roomId).c;
  io.emit('room:updated', { roomId, memberCount: newCount });
  res.json({ ok: true, memberCount: newCount });
});

// ---------- CONVERSATIONS / CHAT ----------
function getOrCreateDm(userA, userB) {
  const existing = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
    JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
    WHERE c.type = 'dm'`).get(userA, userB);
  if (existing) return existing.id;
  const info = db.prepare(`INSERT INTO conversations (type) VALUES ('dm')`).run();
  const cid = info.lastInsertRowid;
  db.prepare(`INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)`).run(cid, userA, cid, userB);
  return cid;
}

app.get('/api/conversations', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.type, c.name,
      (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_body,
      (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_at
    FROM conversations c
    JOIN conversation_members m ON m.conversation_id = c.id
    WHERE m.user_id = ?
    ORDER BY last_at DESC NULLS LAST`).all(req.userId);

  const result = rows.map(c => {
    let title = c.name;
    let other = null;
    if (c.type === 'dm') {
      other = db.prepare(`
        SELECT ${PUBLIC_FIELDS} FROM users u
        JOIN conversation_members m ON m.user_id = u.id
        WHERE m.conversation_id = ? AND u.id != ?`).get(c.id, req.userId);
      title = other ? other.username : 'Unknown';
    }
    return {
      id: c.id, type: c.type, title,
      other: other ? publicUser(other) : null,
      lastMessage: c.last_body, lastAt: c.last_at,
    };
  });
  res.json({ conversations: result });
});

app.post('/api/conversations/dm', requireAuth, (req, res) => {
  const { userId } = req.body || {};
  const otherId = Number(userId);
  if (!otherId) return res.status(400).json({ error: 'userId required' });
  const cid = getOrCreateDm(req.userId, otherId);
  res.json({ conversationId: cid });
});

app.get('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const cid = Number(req.params.id);
  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(cid, req.userId);
  if (!member) return res.status(403).json({ error: 'Not a member of this conversation' });
  const messages = db.prepare(`
    SELECT m.id, m.body, m.created_at, m.sender_id, u.username as sender_name, u.avatar_color as sender_color
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? ORDER BY m.id ASC LIMIT 200`).all(cid);
  res.json({ messages });
});

app.post('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const cid = Number(req.params.id);
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body required' });
  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(cid, req.userId);
  if (!member) return res.status(403).json({ error: 'Not a member of this conversation' });
  const info = db.prepare(`INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)`).run(cid, req.userId, body.trim());
  const sender = db.prepare('SELECT username, avatar_color FROM users WHERE id = ?').get(req.userId);
  const message = {
    id: info.lastInsertRowid, conversationId: cid, body: body.trim(),
    senderId: req.userId, senderName: sender.username, senderColor: sender.avatar_color,
    createdAt: Math.floor(Date.now() / 1000),
  };
  io.to(`conversation:${cid}`).emit('chat:message', message);
  res.json({ message });
});

// ---------- SOCKET.IO ----------
const onlineUsers = new Map(); // userId -> socket count

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const payload = token && verifyToken(token);
  if (!payload) return next(new Error('unauthorized'));
  socket.userId = payload.id;
  next();
});

io.on('connection', (socket) => {
  const uid = socket.userId;
  socket.join(`user:${uid}`);

  const convs = db.prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ?').all(uid);
  convs.forEach(c => socket.join(`conversation:${c.conversation_id}`));

  const count = (onlineUsers.get(uid) || 0) + 1;
  onlineUsers.set(uid, count);
  if (count === 1) {
    db.prepare(`UPDATE users SET status = 'online' WHERE id = ?`).run(uid);
    io.emit('presence:update', { userId: uid, status: 'online' });
  }

  socket.on('chat:typing', ({ conversationId }) => {
    socket.to(`conversation:${conversationId}`).emit('chat:typing', { conversationId, userId: uid });
  });

  socket.on('chat:join', ({ conversationId }) => {
    const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, uid);
    if (member) socket.join(`conversation:${conversationId}`);
  });

  socket.on('disconnect', () => {
    const c = (onlineUsers.get(uid) || 1) - 1;
    if (c <= 0) {
      onlineUsers.delete(uid);
      db.prepare(`UPDATE users SET status = 'offline', last_seen = strftime('%s','now') WHERE id = ?`).run(uid);
      io.emit('presence:update', { userId: uid, status: 'offline' });
    } else {
      onlineUsers.set(uid, c);
    }
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Vortexx server running on port ${PORT}`));

module.exports = { app, server, io };
