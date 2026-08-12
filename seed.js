const bcrypt = require('bcryptjs');
const db = require('./db');

const games = [
  { name: 'Fortnite', slug: 'fortnite', color: '#a855f7', icon: '🪂' },
  { name: 'Call of Duty: Warzone', slug: 'warzone', color: '#f97316', icon: '🎯' },
  { name: 'Apex Legends', slug: 'apex', color: '#ef4444', icon: '⚡' },
  { name: 'Valorant', slug: 'valorant', color: '#ec4899', icon: '🔫' },
  { name: 'Minecraft', slug: 'minecraft', color: '#22c55e', icon: '⛏️' },
  { name: 'Rocket League', slug: 'rocket-league', color: '#3b82f6', icon: '🚀' },
];

const insertGame = db.prepare('INSERT OR IGNORE INTO games (name, slug, color, icon) VALUES (?, ?, ?, ?)');
games.forEach(g => insertGame.run(g.name, g.slug, g.color, g.icon));

const bots = [
  { username: 'ShadowX', email: 'shadowx@bots.vortexx', color: '#8b5cf6', status: 'online', statusText: 'Playing Fortnite' },
  { username: 'LunaPlayz', email: 'lunaplayz@bots.vortexx', color: '#ec4899', status: 'online', statusText: 'In Lobby' },
  { username: 'ZyroX', email: 'zyrox@bots.vortexx', color: '#22d3ee', status: 'online', statusText: 'Playing Apex Legends' },
  { username: 'NeonKnight', email: 'neonknight@bots.vortexx', color: '#f59e0b', status: 'online', statusText: 'In Game' },
  { username: 'xTriix', email: 'xtriix@bots.vortexx', color: '#10b981', status: 'online', statusText: 'Playing Valorant' },
  { username: 'Ghosty', email: 'ghosty@bots.vortexx', color: '#3b82f6', status: 'offline', statusText: 'In Lobby' },
];

const insertBot = db.prepare(`INSERT OR IGNORE INTO users (username, email, password_hash, avatar_color, status, status_text, is_bot, level, xp, xp_max, wins, games_played, kd)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`);
const dummyHash = bcrypt.hashSync('not-a-real-password-' + Math.random(), 10);
bots.forEach(b => {
  insertBot.run(
    b.username, b.email, dummyHash, b.color, b.status, b.statusText,
    Math.floor(Math.random() * 40) + 5,
    Math.floor(Math.random() * 5000),
    6000,
    Math.floor(Math.random() * 100) + 10,
    Math.floor(Math.random() * 300) + 50,
    +(Math.random() * 3 + 0.5).toFixed(2)
  );
});

// Seed a few demo rooms
const gameRows = db.prepare('SELECT * FROM games').all();
const roomCount = db.prepare('SELECT COUNT(*) as c FROM rooms').get().c;
if (roomCount === 0) {
  const insertRoom = db.prepare('INSERT INTO rooms (game_id, name, mode, region, max_size, created_by) VALUES (?, ?, ?, ?, ?, NULL)');
  const fortnite = gameRows.find(g => g.slug === 'fortnite');
  const warzone = gameRows.find(g => g.slug === 'warzone');
  const apex = gameRows.find(g => g.slug === 'apex');
  if (fortnite) insertRoom.run(fortnite.id, 'Ranked Zero Build', 'Squad', 'Europe', 4);
  if (warzone) insertRoom.run(warzone.id, 'Resurgence', 'Squad', 'NA East', 4);
  if (apex) insertRoom.run(apex.id, 'Ranked', 'Squad', 'Asia', 3);

  const botIds = db.prepare('SELECT id FROM users WHERE is_bot = 1').all().map(r => r.id);
  const roomIds = db.prepare('SELECT id FROM rooms').all().map(r => r.id);
  const insertMember = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)');
  roomIds.forEach((rid, i) => {
    botIds.slice(i, i + 2).forEach(bid => insertMember.run(rid, bid));
  });
}

console.log('Seed complete. Games:', db.prepare('SELECT COUNT(*) as c FROM games').get().c,
  'Users:', db.prepare('SELECT COUNT(*) as c FROM users').get().c,
  'Rooms:', db.prepare('SELECT COUNT(*) as c FROM rooms').get().c);
