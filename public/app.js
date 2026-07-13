'use strict';

// ============ Session (anonim swipe-hoz) ============
function getSession() {
  let s = localStorage.getItem('dornsite_session');
  if (!s) {
    s = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('dornsite_session', s);
  }
  return s;
}
const SESSION = getSession();

// ============ Auth (felhasználói fiók) ============
const Auth = {
  token: localStorage.getItem('dornsite_user_token') || '',
  user: null,
  headers(extra = {}) {
    return this.token ? { Authorization: `Bearer ${this.token}`, ...extra } : extra;
  },
  set(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('dornsite_user_token', token);
    updateAuthUI();
  },
  clear() {
    this.token = '';
    this.user = null;
    localStorage.removeItem('dornsite_user_token');
    updateAuthUI();
  },
  async refresh() {
    if (!this.token) {
      this.user = null;
      updateAuthUI();
      return;
    }
    try {
      const res = await fetch('/api/auth/me', { headers: this.headers() });
      if (res.ok) this.user = (await res.json()).user;
      else this.clear();
    } catch {
      /* offline – token megmarad */
    }
    updateAuthUI();
  },
};

// ============ Google bejelentkezés (ha be van állítva) ============
async function initGoogle() {
  let cfg;
  try {
    cfg = await (await fetch('/api/auth/config')).json();
  } catch {
    return;
  }
  if (!cfg.google || !cfg.googleClientId) return;

  const note = document.getElementById('authNote');
  if (note) note.classList.add('hidden');

  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onload = () => {
    if (!window.google || !google.accounts || !google.accounts.id) return;
    google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: onGoogleCredential,
    });
    google.accounts.id.renderButton(document.getElementById('googleSignin'), {
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      width: 300,
    });
    document.getElementById('googleWrap').classList.remove('hidden');
  };
  document.head.appendChild(script);
}

async function onGoogleCredential(response) {
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await res.json();
    if (res.ok) {
      Auth.set(data.token, data.user);
      closeAuth();
      toast('Belépve Google fiókkal 👋');
    } else {
      toast(data.error || 'Google belépés sikertelen');
    }
  } catch {
    toast('Hálózati hiba a Google belépésnél');
  }
}

// ============ DOM ============
const deck = document.getElementById('deck');
const emptyEl = document.getElementById('empty');
const loadingEl = document.getElementById('loading');
const likeCountEl = document.getElementById('likeCount');

let queue = [];
let activeTag = ''; // '' = minden címke

// ============ API ============
async function fetchCards() {
  const tagParam = activeTag ? `&tag=${encodeURIComponent(activeTag)}` : '';
  const res = await fetch(`/api/cards?session=${encodeURIComponent(SESSION)}&limit=15${tagParam}`);
  const data = await res.json();
  return data.cards || [];
}

// ============ Címke-szűrő sáv ============
const filterBar = document.getElementById('filterBar');

async function loadFilterBar() {
  let tags = [];
  try {
    tags = (await (await fetch('/api/tags')).json()).tags || [];
  } catch {
    return;
  }
  if (tags.length === 0) {
    filterBar.classList.add('hidden');
    return;
  }
  filterBar.classList.remove('hidden');
  filterBar.innerHTML = '';
  const chips = [{ name: '', label: 'Mind' }, ...tags.map((t) => ({ name: t.name, label: `#${t.name}` }))];
  for (const c of chips) {
    const btn = document.createElement('button');
    btn.className = 'chip' + (c.name === activeTag ? ' active' : '');
    btn.textContent = c.label;
    btn.addEventListener('click', () => selectTag(c.name));
    filterBar.appendChild(btn);
  }
}

function selectTag(tag) {
  if (tag === activeTag) return;
  activeTag = tag;
  loadFilterBar();
  init();
}

async function sendVote(contentId, direction) {
  try {
    await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentId, direction, session: SESSION }),
    });
  } catch (e) {
    console.error('Szavazat hiba:', e);
  }
}

async function refreshLikeCount() {
  try {
    const res = await fetch(`/api/likes?session=${encodeURIComponent(SESSION)}`);
    const data = await res.json();
    likeCountEl.textContent = data.stats?.like || 0;
  } catch (e) {}
}

// ============ Kártya ============
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function mediaHtml(item, extra = '') {
  return item.type === 'video'
    ? `<video src="${item.url}" muted loop playsinline autoplay ${extra}></video>`
    : `<img src="${item.url}" alt="" draggable="false" ${extra}>`;
}

function buildCard(item) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = item.id;
  card._item = item;
  card.innerHTML = `
    ${mediaHtml(item)}
    <div class="badge like">TETSZIK</div>
    <div class="badge nope">NEM</div>
    ${item.title ? `<div class="card-caption">${escapeHtml(item.title)}</div>` : ''}
  `;
  attachDrag(card);
  return card;
}

function renderDeck() {
  loadingEl.classList.add('hidden');
  if (queue.length === 0 && deck.children.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  while (deck.children.length < 3 && queue.length > 0) {
    const card = buildCard(queue.shift());
    deck.insertBefore(card, deck.firstChild);
  }
  updateStackStyles();
}

function updateStackStyles() {
  const cards = Array.from(deck.children);
  const n = cards.length;
  cards.forEach((c, i) => {
    const depth = n - 1 - i;
    c.style.transform = `translateY(${depth * 10}px) scale(${1 - depth * 0.04})`;
    c.style.zIndex = i;
    c.style.opacity = depth > 2 ? 0 : 1;
  });
}

// ============ Drag & swipe ============
function attachDrag(card) {
  let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false, moved = false;
  const likeBadge = () => card.querySelector('.badge.like');
  const nopeBadge = () => card.querySelector('.badge.nope');

  function onDown(e) {
    if (card !== deck.lastElementChild) return;
    dragging = true; moved = false;
    const p = point(e);
    startX = p.x; startY = p.y;
    card.style.transition = 'none';
  }
  function onMove(e) {
    if (!dragging) return;
    const p = point(e);
    dx = p.x - startX; dy = p.y - startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const ratio = Math.min(Math.abs(dx) / 120, 1);
    if (dx > 0) { likeBadge().style.opacity = ratio; nopeBadge().style.opacity = 0; }
    else { nopeBadge().style.opacity = ratio; likeBadge().style.opacity = 0; }
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    card.style.transition = 'transform 0.3s ease';
    if (dx > 110) return flyOut(card, 'like');
    if (dx < -110) return flyOut(card, 'dislike');
    card.style.transform = '';
    likeBadge().style.opacity = 0;
    nopeBadge().style.opacity = 0;
    updateStackStyles();
    dx = 0; dy = 0;
  }

  card.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  card.addEventListener('touchstart', onDown, { passive: true });
  card.addEventListener('touchmove', onMove, { passive: true });
  card.addEventListener('touchend', onUp);
  // Koppintás (mozgatás nélkül) → részletek
  card.addEventListener('click', () => { if (!moved) openDetail(card._item.id); });
}

function point(e) {
  if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function flyOut(card, direction) {
  const id = parseInt(card.dataset.id, 10);
  const dir = direction === 'like' ? 1 : -1;
  card.style.transition = 'transform 0.4s ease';
  card.style.transform = `translate(${dir * window.innerWidth}px, -40px) rotate(${dir * 30}deg)`;
  sendVote(id, direction).then(() => { if (direction === 'like') refreshLikeCount(); });
  setTimeout(() => {
    card.remove();
    if (queue.length < 3) topUp();
    renderDeck();
  }, 320);
}

function swipeTop(direction) {
  const top = deck.lastElementChild;
  if (top) flyOut(top, direction);
}

let loading = false;
async function topUp() {
  if (loading) return;
  loading = true;
  const more = await fetchCards();
  const inDeck = new Set(Array.from(deck.children).map((c) => c.dataset.id));
  for (const item of more) if (!inDeck.has(String(item.id))) queue.push(item);
  loading = false;
}

// ============ Kedveltek panel ============
const likesPanel = document.getElementById('likesPanel');
const likesGrid = document.getElementById('likesGrid');
const likesEmpty = document.getElementById('likesEmpty');

async function openLikes() {
  const res = await fetch(`/api/likes?session=${encodeURIComponent(SESSION)}`);
  const data = await res.json();
  const liked = data.liked || [];
  likesGrid.innerHTML = '';
  if (liked.length === 0) {
    likesEmpty.classList.remove('hidden');
  } else {
    likesEmpty.classList.add('hidden');
    for (const item of liked) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML = mediaHtml(item);
      tile.addEventListener('click', () => openDetail(item.id));
      likesGrid.appendChild(tile);
    }
  }
  likesPanel.classList.remove('hidden');
}

// ============ Részlet + megosztás + kommentek ============
const detailPanel = document.getElementById('detailPanel');
const detailTitle = document.getElementById('detailTitle');
const detailMedia = document.getElementById('detailMedia');
const detailLink = document.getElementById('detailLink');
const commentsList = document.getElementById('commentsList');
const commentCount = document.getElementById('commentCount');
const commentForm = document.getElementById('commentForm');
const commentInput = document.getElementById('commentInput');
const commentLoginHint = document.getElementById('commentLoginHint');
let currentDetailId = null;

async function openDetail(id) {
  currentDetailId = id;
  detailMedia.innerHTML = '';
  detailTitle.textContent = 'Betöltés…';
  detailLink.classList.add('hidden');
  document.getElementById('detailTags').innerHTML = '';
  commentsList.innerHTML = '';
  commentCount.textContent = '0';
  detailPanel.classList.remove('hidden');

  try {
    const res = await fetch(`/api/content/${id}`);
    if (!res.ok) { detailTitle.textContent = 'A tartalom nem található'; return; }
    const { content } = await res.json();
    detailTitle.textContent = content.title || 'Tartalom';
    detailMedia.innerHTML = mediaHtml(content);
    renderDetailTags(content.tags || []);
    if (content.link) {
      detailLink.href = content.link;
      detailLink.classList.remove('hidden');
    }
  } catch {
    detailTitle.textContent = 'Hiba a betöltéskor';
  }

  updateCommentUI();
  loadComments(id);
}

function renderDetailTags(tags) {
  const el = document.getElementById('detailTags');
  el.innerHTML = '';
  for (const name of tags) {
    const chip = document.createElement('button');
    chip.className = 'chip small';
    chip.textContent = `#${name}`;
    chip.addEventListener('click', () => {
      closeDetail();
      selectTag(name);
    });
    el.appendChild(chip);
  }
}

function closeDetail() {
  detailPanel.classList.add('hidden');
  currentDetailId = null;
  // deep-link paraméter eltávolítása a címsorból
  if (location.search) history.replaceState(null, '', location.pathname);
}

async function loadComments(id) {
  try {
    const res = await fetch(`/api/content/${id}/comments`);
    const { comments } = await res.json();
    commentCount.textContent = comments.length;
    commentsList.innerHTML = comments.length
      ? comments.map(commentHtml).join('')
      : '<p class="comment-hint">Legyél te az első, aki hozzászól!</p>';
    commentsList.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => deleteComment(b.dataset.del))
    );
  } catch {
    commentsList.innerHTML = '<p class="comment-hint">A kommentek nem tölthetők be.</p>';
  }
}

function commentHtml(c) {
  const mine = Auth.user && Auth.user.id === c.user_id;
  const when = String(c.created_at || '').replace('T', ' ').slice(0, 16);
  return `
    <div class="comment">
      <div class="comment-head">
        <span class="comment-author">${escapeHtml(c.display_name)}</span>
        <span class="comment-date">${escapeHtml(when)}</span>
        ${mine ? `<button class="comment-del" data-del="${c.id}" title="Törlés">🗑</button>` : ''}
      </div>
      <div class="comment-body">${escapeHtml(c.body)}</div>
    </div>`;
}

function updateCommentUI() {
  if (Auth.user) {
    commentForm.classList.remove('hidden');
    commentLoginHint.classList.add('hidden');
  } else {
    commentForm.classList.add('hidden');
    commentLoginHint.classList.remove('hidden');
  }
}

commentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = commentInput.value.trim();
  if (!body || !currentDetailId) return;
  try {
    const res = await fetch(`/api/content/${currentDetailId}/comments`, {
      method: 'POST',
      headers: Auth.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      commentInput.value = '';
      loadComments(currentDetailId);
    } else if (res.status === 401) {
      Auth.clear();
      openAuth();
    } else {
      const err = await res.json().catch(() => ({}));
      toast(err.error || 'Nem sikerült elküldeni');
    }
  } catch {
    toast('Hálózati hiba');
  }
});

async function deleteComment(id) {
  if (!confirm('Törlöd a kommentet?')) return;
  const res = await fetch(`/api/comments/${id}`, { method: 'DELETE', headers: Auth.headers() });
  if (res.ok) loadComments(currentDetailId);
  else toast('Nem törölhető');
}

// Megosztás
document.getElementById('shareBtn').addEventListener('click', async () => {
  if (!currentDetailId) return;
  const url = `${location.origin}/?c=${currentDetailId}`;
  const title = detailTitle.textContent;
  if (navigator.share) {
    try { await navigator.share({ title: 'Dornsite', text: title, url }); return; } catch {}
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link a vágólapra másolva 📋');
  } catch {
    prompt('Másold ki a linket:', url);
  }
});

// ============ Auth UI ============
const authModal = document.getElementById('authModal');
const authBtn = document.getElementById('authBtn');

function updateAuthUI() {
  if (Auth.user) {
    authBtn.textContent = `👤 ${Auth.user.displayName || 'Profil'}`;
    authBtn.title = 'Kijelentkezés';
  } else {
    authBtn.textContent = 'Belépés';
    authBtn.title = 'Belépés / regisztráció';
  }
  updateCommentUI();
  // a kommentek újrarajzolása a saját-törlés gomb miatt
  if (currentDetailId && !detailPanel.classList.contains('hidden')) loadComments(currentDetailId);
}

function openAuth() { authModal.classList.remove('hidden'); }
function closeAuth() { authModal.classList.add('hidden'); }

authBtn.addEventListener('click', () => {
  if (Auth.user) {
    if (confirm('Kijelentkezel?')) Auth.clear();
  } else {
    openAuth();
  }
});
document.getElementById('closeAuth').addEventListener('click', closeAuth);
authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuth(); });

document.querySelectorAll('.auth-tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    document.getElementById('loginForm').classList.toggle('hidden', !isLogin);
    document.getElementById('registerForm').classList.toggle('hidden', isLogin);
  })
);

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value,
      }),
    });
    const data = await res.json();
    if (res.ok) { Auth.set(data.token, data.user); closeAuth(); toast('Sikeres belépés 👋'); }
    else showAuthError(errEl, data.error);
  } catch { showAuthError(errEl, 'Hálózati hiba'); }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('registerError');
  errEl.classList.add('hidden');
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: document.getElementById('regName').value,
        email: document.getElementById('regEmail').value,
        password: document.getElementById('regPassword').value,
      }),
    });
    const data = await res.json();
    if (res.ok) { Auth.set(data.token, data.user); closeAuth(); toast('Fiók létrehozva 🎉'); }
    else showAuthError(errEl, data.error);
  } catch { showAuthError(errEl, 'Hálózati hiba'); }
});

function showAuthError(el, msg) {
  el.textContent = msg || 'Hiba történt';
  el.classList.remove('hidden');
}

document.getElementById('commentLoginBtn').addEventListener('click', openAuth);

// ============ Toast ============
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}

// ============ Események ============
document.getElementById('likeBtn').addEventListener('click', () => swipeTop('like'));
document.getElementById('nopeBtn').addEventListener('click', () => swipeTop('dislike'));
document.getElementById('infoBtn').addEventListener('click', () => {
  const top = deck.lastElementChild;
  if (top) openDetail(top._item.id);
});
document.getElementById('restartBtn').addEventListener('click', init);
document.getElementById('likesBtn').addEventListener('click', openLikes);
document.getElementById('closeLikes').addEventListener('click', () => likesPanel.classList.add('hidden'));
document.getElementById('closeDetail').addEventListener('click', closeDetail);

window.addEventListener('keydown', (e) => {
  if (!authModal.classList.contains('hidden')) return;
  if (!detailPanel.classList.contains('hidden')) { if (e.key === 'Escape') closeDetail(); return; }
  if (e.key === 'ArrowRight') swipeTop('like');
  if (e.key === 'ArrowLeft') swipeTop('dislike');
});

// ============ Indítás ============
async function init() {
  emptyEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  deck.innerHTML = '';
  queue = [];
  const cards = await fetchCards();
  queue = cards;
  renderDeck();
  refreshLikeCount();
}

(async function start() {
  await Auth.refresh();
  initGoogle();
  loadFilterBar();
  await init();
  // Megosztott mélylink: ?c=ID → nyisd meg a részletet
  const params = new URLSearchParams(location.search);
  const cid = params.get('c');
  if (cid) openDetail(parseInt(cid, 10));
})();
