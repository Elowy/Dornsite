'use strict';

const loginView = document.getElementById('loginView');
const adminView = document.getElementById('adminView');

let token = localStorage.getItem('dornsite_admin_token') || '';

function authHeaders(extra = {}) {
  return token ? { Authorization: `Bearer ${token}`, ...extra } : extra;
}

// --- Bejelentkezés ellenőrzése ---
async function checkAuth() {
  if (!token) return showLogin();
  try {
    const res = await fetch('/api/admin/check', { headers: authHeaders() });
    if (res.ok) showAdmin();
    else showLogin();
  } catch {
    showLogin();
  }
}

function showLogin() {
  loginView.classList.remove('hidden');
  adminView.classList.add('hidden');
}
function showAdmin() {
  loginView.classList.add('hidden');
  adminView.classList.remove('hidden');
  loadStats();
  loadContent();
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const data = await res.json();
      token = data.token;
      localStorage.setItem('dornsite_admin_token', token);
      showAdmin();
    } else {
      errEl.classList.remove('hidden');
    }
  } catch {
    errEl.classList.remove('hidden');
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { await fetch('/api/admin/logout', { method: 'POST', headers: authHeaders() }); } catch {}
  token = '';
  localStorage.removeItem('dornsite_admin_token');
  showLogin();
});

// --- Statisztika ---
async function loadStats() {
  const res = await fetch('/api/admin/stats', { headers: authHeaders() });
  if (!res.ok) return;
  const s = await res.json();
  const grid = document.getElementById('stats');
  grid.innerHTML = `
    ${stat(s.totalContent, 'Összes tartalom')}
    ${stat(s.activeContent, 'Aktív tartalom')}
    ${stat(s.totalVotes, 'Összes szavazat')}
    ${stat(s.totalLikes, '❤️ Tetszik')}
    ${stat(s.totalDislikes, '✕ Nem tetszik')}
    ${stat(s.sessions, 'Egyedi látogató')}
    ${stat(s.totalUsers ?? 0, '👤 Regisztrált fiók')}
    ${stat(s.totalComments ?? 0, '💬 Komment')}
  `;
}

function stat(num, label) {
  return `<div class="stat"><div class="num">${num}</div><div class="label">${label}</div></div>`;
}

// --- Tartalom lista ---
async function loadContent() {
  const res = await fetch('/api/admin/content', { headers: authHeaders() });
  if (!res.ok) return;
  const { content } = await res.json();
  document.getElementById('contentCount').textContent = content.length;
  const grid = document.getElementById('contentGrid');

  if (content.length === 0) {
    grid.innerHTML = '<p class="empty-note">Még nincs feltöltött tartalom.</p>';
    return;
  }

  grid.innerHTML = content.map(itemHtml).join('');
  window._contentCache = content;

  grid.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', () => deleteContent(btn.dataset.del))
  );
  grid.querySelectorAll('[data-toggle]').forEach((btn) =>
    btn.addEventListener('click', () => toggleContent(btn.dataset.toggle, btn.dataset.active === 'true'))
  );
  grid.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => editContent(btn.dataset.edit))
  );
}

async function editContent(id) {
  const c = (window._contentCache || []).find((x) => String(x.id) === String(id));
  const title = prompt('Cím:', c ? c.title : '');
  if (title === null) return;
  const link = prompt('Link (üresen hagyható):', c ? c.link || '' : '');
  if (link === null) return;
  const tags = prompt('Címkék vesszővel elválasztva:', c && c.tags ? c.tags.join(', ') : '');
  if (tags === null) return;
  await fetch(`/api/admin/content/${id}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title, link, tags }),
  });
  loadContent();
}

function itemHtml(c) {
  const media = c.type === 'video'
    ? `<video src="${c.url}" muted></video>`
    : `<img src="${c.url}" alt="">`;
  const link = c.link
    ? `<a class="item-link" href="${escapeHtml(c.link)}" target="_blank" rel="noopener">🔗 link</a>`
    : '';
  const tags = (c.tags && c.tags.length)
    ? `<div class="item-tags">${c.tags.map((t) => `<span class="tagchip">#${escapeHtml(t)}</span>`).join('')}</div>`
    : '';
  return `
    <div class="item ${c.active ? '' : 'inactive'}">
      <div class="thumb">${media}</div>
      <div class="item-body">
        <div class="item-title">${escapeHtml(c.title) || '<em>Cím nélkül</em>'}</div>
        <div class="item-votes">
          <span class="l">❤️ ${c.likes}</span>
          <span class="d">✕ ${c.dislikes}</span>
          <span class="c">💬 ${c.comments || 0}</span>
        </div>
        ${tags}
        ${link}
        <div class="item-actions">
          <button data-edit="${c.id}">Szerkeszt</button>
          <button data-toggle="${c.id}" data-active="${c.active}">${c.active ? 'Elrejt' : 'Megjelenít'}</button>
          <button class="del" data-del="${c.id}">Törlés</button>
        </div>
      </div>
    </div>`;
}

async function deleteContent(id) {
  if (!confirm('Biztosan törlöd ezt a tartalmat?')) return;
  await fetch(`/api/admin/content/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadContent();
  loadStats();
}

async function toggleContent(id, active) {
  await fetch(`/api/admin/content/${id}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ active: !active }),
  });
  loadContent();
  loadStats();
}

// --- Feltöltés ---
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const fileList = document.getElementById('fileList');
let selectedFiles = [];

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => setFiles(Array.from(fileInput.files)));

['dragover', 'dragenter'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); })
);
dropzone.addEventListener('drop', (e) => {
  setFiles(Array.from(e.dataTransfer.files));
});

function setFiles(files) {
  selectedFiles = files.filter((f) => /^(image|video)\//.test(f.type));
  fileList.innerHTML = selectedFiles.map((f) => `<div class="f">📎 ${escapeHtml(f.name)}</div>`).join('');
}

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('uploadStatus');
  const btn = document.getElementById('uploadBtn');
  if (selectedFiles.length === 0) {
    status.textContent = 'Válassz ki legalább egy fájlt!';
    return;
  }
  const fd = new FormData();
  fd.append('title', document.getElementById('uploadTitle').value);
  fd.append('link', document.getElementById('uploadLink').value);
  fd.append('tags', document.getElementById('uploadTags').value);
  selectedFiles.forEach((f) => fd.append('files', f));

  btn.disabled = true;
  status.textContent = 'Feltöltés…';
  try {
    const res = await fetch('/api/admin/upload', { method: 'POST', headers: authHeaders(), body: fd });
    if (res.ok) {
      const data = await res.json();
      status.textContent = `${data.count} fájl feltöltve ✔`;
      selectedFiles = [];
      fileList.innerHTML = '';
      fileInput.value = '';
      document.getElementById('uploadTitle').value = '';
      document.getElementById('uploadLink').value = '';
      document.getElementById('uploadTags').value = '';
      loadContent();
      loadStats();
    } else {
      const err = await res.json().catch(() => ({}));
      status.textContent = 'Hiba: ' + (err.error || res.status);
    }
  } catch (err) {
    status.textContent = 'Hálózati hiba';
  } finally {
    btn.disabled = false;
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

checkAuth();
