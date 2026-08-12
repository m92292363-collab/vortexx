# Vortexx

Connect. Squad up. Play. A real, working gaming social app — accounts, friends, real-time chat, and game rooms — built to match the Vortexx mockup.

## What's actually working

- **Real accounts**: sign up / log in with a password (bcrypt-hashed, JWT sessions).
- **Friends**: search players, send/accept/decline requests, see who's online live.
- **Real-time chat**: DMs over WebSockets (Socket.io) — messages arrive instantly on the other person's screen, no refresh.
- **Game rooms**: browse rooms by game, create your own, join/leave, live member counts.
- **Profile**: level, XP bar, stats, achievement badges.
- **Installable app (PWA)**: on a phone, "Add to Home Screen" turns it into an app icon that opens full-screen, no browser chrome.
- 6 demo games and 6 bot players are pre-seeded so it doesn't feel empty on first run.

## Run it locally

```bash
npm install
npm run seed    # only needed once, sets up the database with demo games/bots
npm start
```

Then open **http://localhost:3000** in a browser. Open it in two different browsers (or a normal + incognito window) and sign up as two different users to see real-time chat in action between them.

## Make it "real life" — put it on the internet

Right now it only runs on this machine. To get a real URL you (or anyone) can open from any phone or computer, deploy it to a Node.js host. A few good free/cheap options:

- **Render.com** — connect a GitHub repo, pick "Web Service", it auto-detects `npm start`. Free tier available.
- **Railway.app** — similar one-click deploy from a repo.
- **Fly.io** — `fly launch` in this folder, follows the Dockerfile-free Node buildpack.

Whichever you pick, the only two things to set are:
1. Build command: `npm install`
2. Start command: `npm start`

The SQLite database file lives in `db/vortexx.sqlite` — most of these hosts wipe local disk on redeploy, so for a long-lived production app you'd eventually want to swap SQLite for a hosted Postgres (a day-two upgrade, not needed to get it live).

## Turning it into a native mobile app

This is already a Progressive Web App: once it's deployed to a real URL, visiting it on a phone and choosing "Add to Home Screen" (iOS Safari) or the install prompt (Android Chrome) installs it like a real app icon, no App Store needed. Wrapping it as a true native iOS/Android app (for App Store / Play Store distribution) is a separate, bigger project — frameworks like Capacitor or React Native can wrap this same backend, but that needs an Apple Developer account, Xcode, and app store review, which isn't something that can be done in this environment.

## Project structure

```
server.js     — Express + Socket.io backend, all API routes
db.js         — SQLite schema
auth.js       — JWT helpers
seed.js       — demo games + bot players
public/       — the frontend (index.html, app.js, styles.css, manifest.json, sw.js)
```
