'use strict';

// --- Session azonosító (localStorage-ben tárolva) ---
function getSession() {
  let s = localStorage.getItem('dornsite_session');
  if (!s) {
    s = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('dornsite_session', s);
  }
  return s;
}
const SESSION = getSession();

const deck = document.getElementById('deck');
const emptyEl = document.getElementById('empty');
const loadingEl = document.getElementById('loading');
const likeCountEl = document.getElementById('likeCount');

let queue = [];        // még be nem töltött kártyák
let currentCard = null; // a legfelső DOM kártya

// --- API hívások ---
async function fetchCards() {
  const res = await fetch(`/api/cards?session=${encodeURIComponent(SESSION)}&limit=15`);
  const data = await res.json();
  return data.cards || [];
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
  } catch (e) { /* néma */ }
}

// --- Kártya építése ---
function buildCard(item) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = item.id;

  const media = item.type === 'video'
    ? `<video src="${item.url}" muted loop playsinline autoplay></video>`
    : `<img src="${item.url}" alt="" draggable="false">`;

  card.innerHTML = `
    ${media}
    <div class="badge like">TETSZIK</div>
    <div class="badge nope">NEM</div>
    ${item.title ? `<div class="card-caption">${escapeHtml(item.title)}</div>` : ''}
  `;
  attachDrag(card);
  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Deck renderelése (max 3 kártya egyszerre a mélységhez) ---
function renderDeck() {
  loadingEl.classList.add('hidden');

  if (queue.length === 0 && deck.children.length === 0) {
    emptyEl.classList.remove('hidden');
    currentCard = null;
    return;
  }
  emptyEl.classList.add('hidden');

  while (deck.children.length < 3 && queue.length > 0) {
    const item = queue.shift();
    const card = buildCard(item);
    // Új kártyák a stack aljára kerülnek
    deck.insertBefore(card, deck.firstChild);
  }
  updateStackStyles();
  currentCard = deck.lastElementChild;
}

function updateStackStyles() {
  const cards = Array.from(deck.children); // [alsó ... felső]
  const n = cards.length;
  cards.forEach((c, i) => {
    const depth = n - 1 - i; // 0 = legfelső
    c.style.transform = `translateY(${depth * 10}px) scale(${1 - depth * 0.04})`;
    c.style.zIndex = i;
    c.style.opacity = depth > 2 ? 0 : 1;
  });
}

// --- Drag & swipe logika ---
function attachDrag(card) {
  let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;

  const likeBadge = () => card.querySelector('.badge.like');
  const nopeBadge = () => card.querySelector('.badge.nope');

  function onDown(e) {
    if (card !== deck.lastElementChild) return; // csak a legfelső mozgatható
    dragging = true;
    const p = point(e);
    startX = p.x; startY = p.y;
    card.style.transition = 'none';
  }
  function onMove(e) {
    if (!dragging) return;
    const p = point(e);
    dx = p.x - startX;
    dy = p.y - startY;
    const rot = dx / 18;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
    const ratio = Math.min(Math.abs(dx) / 120, 1);
    if (dx > 0) { likeBadge().style.opacity = ratio; nopeBadge().style.opacity = 0; }
    else { nopeBadge().style.opacity = ratio; likeBadge().style.opacity = 0; }
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    card.style.transition = 'transform 0.3s ease';
    const threshold = 110;
    if (dx > threshold) return flyOut(card, 'like');
    if (dx < -threshold) return flyOut(card, 'dislike');
    // vissza a helyére
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
}

function point(e) {
  if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

// --- Kártya kirepítése + szavazat ---
function flyOut(card, direction) {
  const id = parseInt(card.dataset.id, 10);
  const dir = direction === 'like' ? 1 : -1;
  card.style.transition = 'transform 0.4s ease';
  card.style.transform = `translate(${dir * window.innerWidth}px, -40px) rotate(${dir * 30}deg)`;

  sendVote(id, direction).then(() => {
    if (direction === 'like') refreshLikeCount();
  });

  setTimeout(() => {
    card.remove();
    if (queue.length < 3) topUp();
    renderDeck();
  }, 320);
}

// A programozott gombokhoz
function swipeTop(direction) {
  const top = deck.lastElementChild;
  if (top) flyOut(top, direction);
}

// --- Utántöltés, ha fogy a sor ---
let loading = false;
async function topUp() {
  if (loading) return;
  loading = true;
  const more = await fetchCards();
  // duplikátumok kiszűrése (a már a deckben lévők)
  const inDeck = new Set(Array.from(deck.children).map((c) => c.dataset.id));
  for (const item of more) {
    if (!inDeck.has(String(item.id))) queue.push(item);
  }
  loading = false;
}

// --- Kedveltek panel ---
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
      tile.innerHTML = item.type === 'video'
        ? `<video src="${item.url}" muted loop></video>`
        : `<img src="${item.url}" alt="">`;
      likesGrid.appendChild(tile);
    }
  }
  likesPanel.classList.remove('hidden');
}

// --- Események ---
document.getElementById('likeBtn').addEventListener('click', () => swipeTop('like'));
document.getElementById('nopeBtn').addEventListener('click', () => swipeTop('dislike'));
document.getElementById('restartBtn').addEventListener('click', init);
document.getElementById('likesBtn').addEventListener('click', openLikes);
document.getElementById('closeLikes').addEventListener('click', () => likesPanel.classList.add('hidden'));

// Billentyűzet támogatás
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') swipeTop('like');
  if (e.key === 'ArrowLeft') swipeTop('dislike');
});

// --- Indítás ---
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

init();
