(() => {
  const state = {
    token: localStorage.getItem('vortexx_token') || null,
    user: null,
    games: [],
    friends: [], incoming: [], outgoing: [],
    conversations: [],
    activeConversation: null,
    socket: null,
    roomFilter: { gameId: null, tab: 'discover' },
    friendTab: 'all',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function api(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    return fetch(path, Object.assign({}, opts, { headers }))
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
  }

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 320);
    }, 3000);
  }

  // Assigns --i custom properties to a NodeList/array of elements so their
  // CSS stagger animations (fadeSlideUp, etc.) fire in a cascading sequence.
  function stagger(elements) {
    Array.from(elements).forEach((el, i) => { el.style.setProperty('--i', i); });
  }

  function initials(name) {
    return (name || '?').slice(0, 2).toUpperCase();
  }

  function avatarHtml(user, size) {
    const s = size ? `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.34)}px;` : '';
    return `<div class="avatar" style="background:${user.avatarColor || user.avatar_color || '#8b5cf6'};${s}">${initials(user.username)}<span class="dot ${user.status === 'online' ? 'online' : 'offline'}"></span></div>`;
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return 'now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    return Math.floor(diff / 86400) + 'd';
  }

  // ---------------- LANDING ----------------
  $('#btn-landing-enter').addEventListener('click', () => {
    $('#landing-screen').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
  });

  // ---------------- AUTH ----------------
  $('#show-register').addEventListener('click', () => {
    $('#login-form').classList.add('hidden');
    $('#register-form').classList.remove('hidden');
    $('#auth-switch').innerHTML = 'Already have an account? <span id="show-login">Log in</span>';
    $('#show-login').addEventListener('click', showLogin);
  });
  function showLogin() {
    $('#register-form').classList.add('hidden');
    $('#login-form').classList.remove('hidden');
    $('#auth-switch').innerHTML = 'New here? <span id="show-register-2">Create an account</span>';
    $('#show-register-2').addEventListener('click', () => $('#show-register').click());
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: $('#login-email').value.trim(), password: $('#login-password').value }),
      });
      onAuthed(data);
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#register-error').textContent = '';
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: $('#reg-username').value.trim(),
          email: $('#reg-email').value.trim(),
          password: $('#reg-password').value,
        }),
      });
      onAuthed(data);
    } catch (err) {
      $('#register-error').textContent = err.message;
    }
  });

  function onAuthed(data) {
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('vortexx_token', data.token);
    $('#landing-screen').classList.add('hidden');
    $('#auth-screen').classList.add('hidden');
    $('#main-shell').classList.remove('hidden');
    connectSocket();
    bootstrap();
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    localStorage.removeItem('vortexx_token');
    state.token = null; state.user = null;
    if (state.socket) state.socket.disconnect();
    location.reload();
  }
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-profile-logout').addEventListener('click', logout);

  // ---------------- SOCKET ----------------
  function connectSocket() {
    state.socket = io({ auth: { token: state.token } });
    state.socket.on('chat:message', (msg) => {
      if (state.activeConversation === msg.conversationId) {
        const typingRow = $('#typing-indicator-row');
        if (typingRow) typingRow.remove();
        appendMessage(msg);
      }
      loadConversations();
      if (msg.senderId !== state.user.id) toast(`${msg.senderName}: ${msg.body}`);
    });
    state.socket.on('chat:typing', ({ conversationId, userId }) => {
      if (userId === state.user.id) return;
      showTypingIndicator(conversationId);
    });
    state.socket.on('presence:update', () => { loadFriends(); loadHomeActive(); });
    state.socket.on('friend:request', () => { loadFriends(); toast('New friend request!'); });
    state.socket.on('friend:accepted', () => { loadFriends(); toast('Friend request accepted!'); });
    state.socket.on('room:created', () => renderRooms());
    state.socket.on('room:updated', () => renderRooms());
  }

  // ---------------- NAV ----------------
  const screens = ['home', 'friends', 'games', 'chat-list', 'chat-thread', 'profile'];
  function showScreen(name) {
    screens.forEach(s => {
      const el = $('#screen-' + s);
      if (el) el.classList.toggle('hidden', s !== name);
    });
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.nav === name || (name === 'chat-thread' && n.dataset.nav === 'chat-list')));
    if (name === 'friends') loadFriends();
    if (name === 'games') renderRooms();
    if (name === 'chat-list') loadConversations();
    if (name === 'profile') renderProfile();
    if (name === 'home') { renderHomeProfile(); loadHomeActive(); }
  }
  $$('.nav-item, [data-nav]').forEach(el => {
    el.addEventListener('click', () => { if (el.dataset.nav) showScreen(el.dataset.nav); });
  });

  // ---------------- BOOTSTRAP ----------------
  async function bootstrap() {
    try {
      const me = await api('/api/auth/me');
      state.user = me.user;
    } catch (e) { logout(); return; }
    const g = await api('/api/games');
    state.games = g.games;
    renderGameFilterRow();
    renderHomeGames();
    showScreen('home');
    loadFriends();
    loadHomeActive();
  }

  // ---------------- HOME ----------------
  function renderHomeProfile() {
    if (!state.user) return;
    const u = state.user;
    const pct = Math.min(100, Math.round(u.xp / u.xpMax * 100));
    $('#home-profile-card').innerHTML = `
      ${avatarHtml(u, 52)}
      <div class="info">
        <div class="name">${u.username} <span style="color:#8b5cf6;font-size:12px;">✓</span></div>
        <div class="level">Level ${u.level} · ${u.status === 'online' ? 'Online' : 'Offline'}</div>
        <div class="xp-bar"><div class="xp-fill" id="home-xp-fill" style="width:0%"></div></div>
        <div class="xp-text">${u.xp} / ${u.xpMax} XP</div>
      </div>`;
    // Set to 0 first (already default), then bump to target on the next frame so the
    // width transition actually animates instead of snapping straight to its final value.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const fill = $('#home-xp-fill');
        if (fill) fill.style.width = pct + '%';
      });
    });
  }

  function renderHomeGames() {
    $('#home-games').innerHTML = state.games.map(g => `
      <div class="game-tile" data-game-id="${g.id}">
        <div class="art" style="background:linear-gradient(160deg, ${g.color}55, ${g.color}11)">${g.icon}</div>
        <div class="label">${g.name}</div>
      </div>`).join('');
    stagger($$('#home-games .game-tile'));
    $$('#home-games .game-tile').forEach(t => t.addEventListener('click', () => {
      state.roomFilter.gameId = t.dataset.gameId;
      showScreen('games');
    }));
  }

  async function loadHomeActive() {
    try {
      const data = await api('/api/friends');
      const online = data.friends.filter(f => f.status === 'online');
      $('#home-active').innerHTML = (online.length ? online : data.friends).slice(0, 10).map(u => `
        <div class="person" data-user="${u.id}">
          ${avatarHtml(u, 54)}
          <div class="pname">${u.username}</div>
        </div>`).join('') || '<div class="empty-state">No friends yet — add some!</div>';
      stagger($$('#home-active .person'));
      $$('#home-active .person').forEach(p => p.addEventListener('click', () => openDm(Number(p.dataset.user))));
    } catch (e) {}
  }

  $('#btn-find-players').addEventListener('click', () => { showScreen('friends'); $('#friend-search').focus(); });

  // ---------------- FEATURED CAROUSEL ----------------
  (function initFeaturedCarousel() {
    const slides = $$('.featured-slide');
    const dots = $$('.fdot');
    if (!slides.length) return;
    let active = 0;
    let timer;

    function goTo(i) {
      active = (i + slides.length) % slides.length;
      slides.forEach((s, idx) => s.classList.toggle('active', idx === active));
      dots.forEach((d, idx) => d.classList.toggle('active', idx === active));
    }
    function restart() {
      clearInterval(timer);
      timer = setInterval(() => goTo(active + 1), 4500);
    }
    dots.forEach((d, i) => d.addEventListener('click', () => { goTo(i); restart(); }));
    restart();
  })();

  // ---------------- FRIENDS ----------------
  async function loadFriends() {
    const data = await api('/api/friends');
    state.friends = data.friends; state.incoming = data.incoming; state.outgoing = data.outgoing;
    const badge = $('#notif-badge');
    if (state.incoming.length) { badge.textContent = state.incoming.length; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
    renderFriendsList();
  }

  function renderFriendsList() {
    const wrap = $('#friends-list');
    let list = state.friends;
    if (state.friendTab === 'online') list = state.friends.filter(f => f.status === 'online');
    if (state.friendTab === 'requests') {
      let html = '';
      if (state.incoming.length) {
        html += '<div class="list-section-label">Incoming Requests</div>';
        html += state.incoming.map(u => `
          <div class="list-item">
            ${avatarHtml(u, 44)}
            <div class="meta"><div class="name">${u.username}</div><div class="sub">wants to be friends</div></div>
            <div style="display:flex;gap:6px;">
              <button class="small-btn accept" data-accept="${u.id}">Accept</button>
              <button class="small-btn decline" data-decline="${u.id}">Decline</button>
            </div>
          </div>`).join('');
      }
      if (state.outgoing.length) {
        html += '<div class="list-section-label">Sent Requests</div>';
        html += state.outgoing.map(u => `
          <div class="list-item">
            ${avatarHtml(u, 44)}
            <div class="meta"><div class="name">${u.username}</div><div class="sub">request pending</div></div>
          </div>`).join('');
      }
      wrap.innerHTML = html || '<div class="empty-state">No pending requests</div>';
      stagger($$('#friends-list .list-item'));
      $$('[data-accept]').forEach(b => b.addEventListener('click', async () => { await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: Number(b.dataset.accept) }) }); loadFriends(); }));
      $$('[data-decline]').forEach(b => b.addEventListener('click', async () => { await api('/api/friends/remove', { method: 'POST', body: JSON.stringify({ userId: Number(b.dataset.decline) }) }); loadFriends(); }));
      return;
    }
    const online = list.filter(f => f.status === 'online');
    const offline = list.filter(f => f.status !== 'online');
    let html = '';
    if (!list.length) html = '<div class="empty-state">No friends here yet. Search above to add some!</div>';
    if (online.length) html += `<div class="list-section-label">Online — ${online.length}</div>` + online.map(friendRow).join('');
    if (state.friendTab === 'all' && offline.length) html += `<div class="list-section-label">Offline — ${offline.length}</div>` + offline.map(friendRow).join('');
    wrap.innerHTML = html;
    stagger($$('#friends-list .list-item'));
    $$('#friends-list .list-item[data-open-dm]').forEach(el => el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openDm(Number(el.dataset.openDm));
    }));
    $$('#friends-list [data-remove]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api('/api/friends/remove', { method: 'POST', body: JSON.stringify({ userId: Number(b.dataset.remove) }) });
      loadFriends();
    }));
  }
  function friendRow(u) {
    return `<div class="list-item" data-open-dm="${u.id}">
      ${avatarHtml(u, 44)}
      <div class="meta"><div class="name">${u.username}</div><div class="sub">${u.statusText || (u.status === 'online' ? 'Online' : 'Offline')}</div></div>
      <button class="small-btn remove" data-remove="${u.id}">Remove</button>
    </div>`;
  }

  $$('[data-friend-tab]').forEach(t => t.addEventListener('click', () => {
    $$('[data-friend-tab]').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    state.friendTab = t.dataset.friendTab;
    renderFriendsList();
  }));

  let searchTimer;
  $('#friend-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (!q) { $('#friend-search-results').innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      const data = await api('/api/friends/search?q=' + encodeURIComponent(q));
      const friendIds = new Set(state.friends.map(f => f.id));
      const outIds = new Set(state.outgoing.map(f => f.id));
      const inIds = new Set(state.incoming.map(f => f.id));
      $('#friend-search-results').innerHTML = data.results.map(u => {
        let btn = `<button class="small-btn add" data-add="${u.id}">Add</button>`;
        if (friendIds.has(u.id)) btn = `<span class="small-btn pending">Friends</span>`;
        else if (outIds.has(u.id)) btn = `<span class="small-btn pending">Pending</span>`;
        else if (inIds.has(u.id)) btn = `<button class="small-btn accept" data-accept="${u.id}">Accept</button>`;
        return `<div class="list-item">${avatarHtml(u, 44)}<div class="meta"><div class="name">${u.username}</div><div class="sub">Level ${u.level}</div></div>${btn}</div>`;
      }).join('') || '<div class="empty-state">No players found</div>';
      stagger($$('#friend-search-results .list-item'));
      $$('#friend-search-results [data-add]').forEach(b => b.addEventListener('click', async () => {
        await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId: Number(b.dataset.add) }) });
        toast('Friend request sent'); loadFriends(); $('#friend-search').dispatchEvent(new Event('input'));
      }));
      $$('#friend-search-results [data-accept]').forEach(b => b.addEventListener('click', async () => {
        await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: Number(b.dataset.accept) }) });
        toast('Friend added'); loadFriends(); $('#friend-search').dispatchEvent(new Event('input'));
      }));
    }, 300);
  });
  $('#btn-add-friend').addEventListener('click', () => $('#friend-search').focus());

  // ---------------- GAME ROOMS ----------------
  function renderGameFilterRow() {
    $('#game-filter-row').innerHTML = `<div class="filter-select active" data-game-filter="">All Games</div>` +
      state.games.map(g => `<div class="filter-select" data-game-filter="${g.id}">${g.icon} ${g.name}</div>`).join('');
    $$('[data-game-filter]').forEach(el => el.addEventListener('click', () => {
      state.roomFilter.gameId = el.dataset.gameFilter || null;
      $$('[data-game-filter]').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      renderRooms();
    }));
  }

  $$('[data-room-tab]').forEach(t => t.addEventListener('click', () => {
    $$('[data-room-tab]').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    state.roomFilter.tab = t.dataset.roomTab;
    renderRooms();
  }));

  async function renderRooms() {
    const wrap = $('#rooms-list');
    wrap.innerHTML = '<div class="loading-spinner">Loading rooms…</div>';
    let rooms;
    if (state.roomFilter.tab === 'mine') {
      const data = await api('/api/rooms/mine');
      rooms = data.rooms;
    } else {
      const q = state.roomFilter.gameId ? `?gameId=${state.roomFilter.gameId}` : '';
      const data = await api('/api/rooms' + q);
      rooms = data.rooms;
    }
    if (!rooms.length) { wrap.innerHTML = '<div class="empty-state">No rooms yet. Tap + to create one!</div>'; return; }
    wrap.innerHTML = rooms.map(r => `
      <div class="room-card">
        <div class="top">
          <div class="icon" style="background:${r.game_color}33;">${r.game_icon}</div>
          <div><div class="name">${r.name}</div><div class="sub">${r.game_name} · ${r.mode} · ${r.region}</div></div>
        </div>
        <div class="bottom">
          <div class="count">${r.member_count}/${r.max_size} members</div>
          <button class="join-btn" data-join="${r.id}">Join</button>
        </div>
      </div>`).join('');
    stagger($$('#rooms-list .room-card'));
    $$('#rooms-list [data-join]').forEach(b => b.addEventListener('click', async () => {
      try {
        b.classList.add('just-joined');
        await api(`/api/rooms/${b.dataset.join}/join`, { method: 'POST' });
        toast('Joined room!', 'success');
        renderRooms();
      } catch (e) { toast(e.message, 'error'); }
    }));
  }

  function openCreateRoomModal() {
    const name = prompt('Room name (e.g. "Ranked Squad Grind"):');
    if (!name) return;
    const gameId = state.games[0] && state.games[0].id;
    const gameChoice = prompt('Game: ' + state.games.map(g => g.name).join(', '), state.games[0]?.name || '');
    const game = state.games.find(g => g.name.toLowerCase() === (gameChoice || '').toLowerCase()) || state.games[0];
    api('/api/rooms', { method: 'POST', body: JSON.stringify({ gameId: game.id, name, mode: 'Squad', region: 'Any Region', maxSize: 4 }) })
      .then(() => { toast('Room created!', 'success'); renderRooms(); })
      .catch(e => toast(e.message, 'error'));
  }
  $('#btn-create-room').addEventListener('click', openCreateRoomModal);
  $('#fab-create-room').addEventListener('click', openCreateRoomModal);

  // ---------------- CHAT ----------------
  async function loadConversations() {
    const data = await api('/api/conversations');
    state.conversations = data.conversations;
    const wrap = $('#conversations-list');
    if (!data.conversations.length) { wrap.innerHTML = '<div class="empty-state">No conversations yet. Add friends and say hi!</div>'; return; }
    wrap.innerHTML = data.conversations.map(c => `
      <div class="list-item" data-open-conv="${c.id}">
        ${c.other ? avatarHtml(c.other, 44) : `<div class="avatar" style="width:44px;height:44px;font-size:14px;background:#8b5cf6;">${initials(c.title)}</div>`}
        <div class="meta">
          <div class="top"><div class="name">${c.title}</div><div class="time">${timeAgo(c.lastAt)}</div></div>
          <div class="sub">${c.lastMessage || 'No messages yet'}</div>
        </div>
      </div>`).join('');
    stagger($$('#conversations-list .list-item'));
    $$('#conversations-list [data-open-conv]').forEach(el => el.addEventListener('click', () => openConversation(Number(el.dataset.openConv))));
  }

  async function openDm(userId) {
    const data = await api('/api/conversations/dm', { method: 'POST', body: JSON.stringify({ userId }) });
    openConversation(data.conversationId);
  }

  async function openConversation(id) {
    state.activeConversation = id;
    showScreen('chat-thread');
    const conv = state.conversations.find(c => c.id === id);
    const other = conv?.other;
    $('#thread-name').textContent = conv?.title || 'Chat';
    $('#thread-status').textContent = other ? (other.status === 'online' ? 'Online' : 'Offline') : '';
    $('#thread-avatar').outerHTML = other ? avatarHtml(other, 36).replace('class="avatar"', 'class="avatar" id="thread-avatar"') : `<div class="avatar" id="thread-avatar" style="width:36px;height:36px;font-size:13px;background:#8b5cf6;">${initials(conv?.title)}</div>`;
    if (state.socket) state.socket.emit('chat:join', { conversationId: id });
    const data = await api(`/api/conversations/${id}/messages`);
    $('#thread-messages').innerHTML = '';
    data.messages.forEach(m => appendMessage({
      senderId: m.sender_id, senderName: m.sender_name, senderColor: m.sender_color, body: m.body, createdAt: m.created_at,
    }));
    scrollMessagesToBottom();
  }

  function appendMessage(msg) {
    const mine = state.user && msg.senderId === state.user.id;
    const row = document.createElement('div');
    row.className = 'msg-row' + (mine ? ' mine' : '');
    row.innerHTML = `<div><div class="msg-bubble">${!mine ? `<div class="msg-sender">${msg.senderName}</div>` : ''}${escapeHtml(msg.body)}</div><div class="msg-meta">${timeAgo(msg.createdAt)}</div></div>`;
    $('#thread-messages').appendChild(row);
    scrollMessagesToBottom();
  }
  function scrollMessagesToBottom() {
    const el = $('#thread-messages');
    el.scrollTop = el.scrollHeight;
  }
  function escapeHtml(str) {
    const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
  }

  $('#thread-back').addEventListener('click', () => showScreen('chat-list'));
  async function sendMessage() {
    const input = $('#thread-input');
    const body = input.value.trim();
    if (!body || !state.activeConversation) return;
    input.value = '';
    try {
      await api(`/api/conversations/${state.activeConversation}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
    } catch (e) { toast(e.message, 'error'); }
  }
  $('#thread-send').addEventListener('click', sendMessage);
  $('#thread-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

  let typingEmitTimer;
  $('#thread-input').addEventListener('input', () => {
    if (!state.activeConversation || !state.socket) return;
    clearTimeout(typingEmitTimer);
    state.socket.emit('chat:typing', { conversationId: state.activeConversation });
    typingEmitTimer = setTimeout(() => {}, 1000);
  });

  let typingHideTimer;
  function showTypingIndicator(conversationId) {
    if (state.activeConversation !== conversationId) return;
    let row = $('#typing-indicator-row');
    if (!row) {
      row = document.createElement('div');
      row.id = 'typing-indicator-row';
      row.className = 'typing-row';
      row.innerHTML = `<div class="typing-bubble"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></div>`;
      $('#thread-messages').appendChild(row);
      scrollMessagesToBottom();
    }
    clearTimeout(typingHideTimer);
    typingHideTimer = setTimeout(() => { row.remove(); }, 2200);
  }

  // ---------------- PROFILE ----------------
  function renderProfile() {
    const u = state.user;
    if (!u) return;
    $('#profile-avatar').outerHTML = avatarHtml(u, 88).replace('class="avatar"', 'class="avatar" id="profile-avatar"');
    $('#profile-username').innerHTML = `${u.username} <span style="color:#8b5cf6;">✓</span>`;
    $('#profile-level').textContent = `Level ${u.level} · ${u.xp}/${u.xpMax} XP`;
    $('#profile-stats').innerHTML = `
      <div class="stat"><div class="val">${u.gamesPlayed}</div><div class="lbl">Games</div></div>
      <div class="stat"><div class="val">${u.wins}</div><div class="lbl">Wins</div></div>
      <div class="stat"><div class="val">${u.kd}</div><div class="lbl">K/D</div></div>`;
    const badges = ['🏆', '🎯', '⚡', '🛡️', '🔥', '💎', '🌟', '🚀', '👑', '🥇'];
    $('#profile-achievements').innerHTML = badges.slice(0, 10).map(b => `<div class="achv">${b}</div>`).join('');
    stagger($$('#profile-achievements .achv'));
  }

  // ---------------- INIT ----------------
  if (state.token) {
    api('/api/auth/me').then(data => {
      state.user = data.user;
      $('#landing-screen').classList.add('hidden');
      $('#auth-screen').classList.add('hidden');
      $('#main-shell').classList.remove('hidden');
      connectSocket();
      bootstrap();
    }).catch(() => {
      localStorage.removeItem('vortexx_token');
      // no valid session — leave the landing screen showing as-is
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
