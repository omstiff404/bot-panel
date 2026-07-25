const socket = io();

// ---------- Auth guard ----------
(async () => {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (!data.loggedIn) { window.location.href = '/login.html'; return; }
  if (data.username === 'master') {
    document.getElementById('navAdminAccounts').classList.remove('hidden');
  }
  loadAllSettings();
  refreshStatus();
})();

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ---------- Theme ----------
const themeToggle = document.getElementById('themeToggle');
function applyTheme(theme) {
  document.body.classList.toggle('theme-light', theme === 'light');
  document.body.classList.toggle('theme-dark', theme !== 'light');
  themeToggle.textContent = theme === 'light' ? '☀️ Mode Terang' : '🌙 Mode Gelap';
  localStorage.setItem('wa-dashboard-theme', theme);
}
themeToggle.addEventListener('click', () => {
  const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
});
applyTheme(localStorage.getItem('wa-dashboard-theme') || 'dark');

// ---------- UI Theme (default/anime/holo) ----------
function applyUiTheme(theme) {
  document.body.setAttribute('data-ui-theme', theme);
  localStorage.setItem('wa-ui-theme', theme);
  document.querySelectorAll('.theme-card').forEach((card) => {
    card.classList.toggle('selected', card.dataset.theme === theme);
  });
}
applyUiTheme(localStorage.getItem('wa-ui-theme') || 'default');

document.querySelectorAll('.theme-card').forEach((card) => {
  card.addEventListener('click', () => applyUiTheme(card.dataset.theme));
});

// ---------- Sidebar section switching ----------
document.querySelectorAll('.settings-nav .nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav .nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.settings-section').forEach((s) => s.classList.remove('active'));
    document.getElementById(`section-${btn.dataset.section}`).classList.add('active');
    if (btn.dataset.section === 'features') loadPluginList();
    if (btn.dataset.section === 'users') loadUsers();
    if (btn.dataset.section === 'limit-vip') loadPremiumList();
    if (btn.dataset.section === 'home') refreshStatus();
    if (btn.dataset.section === 'admin-accounts') loadAccountsList();
  });
});

// ---------- Status Bot (home) ----------
function formatUptime(sec) {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}h ${h}j ${m}m`;
}

async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (!data.ok) return;

    document.getElementById('botNameText').textContent = data.botName;
    document.title = `${data.botName} — Dashboard`;

    const dot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    dot.className = 'status-dot ' + (
      data.status === 'connected' ? 'online' :
      data.status === 'waiting_pairing' || data.status === 'connecting' ? 'connecting' : 'offline'
    );
    const statusLabel = {
      connected: '🟢 Terhubung',
      connecting: '🟡 Menghubungkan...',
      waiting_pairing: '🟡 Menunggu Pairing Code',
      disconnected: '🔴 Belum terhubung — pasang pairing code dulu'
    };
    statusText.textContent = statusLabel[data.status] || data.status;

    if (data.profilePicUrl) document.getElementById('botAvatar').src = data.profilePicUrl;

    document.getElementById('statRuntime').textContent = formatUptime(data.uptimeSeconds);
    document.getElementById('statFeatures').textContent = data.totalFeatures;
    document.getElementById('statUsers').textContent = data.totalUsers;

    // nomor bot SUDAH disamarkan dari server (mis. 6281****789), bukan ditampilkan utuh
    document.getElementById('infoNumber').textContent = data.number || 'Belum terhubung';
    document.getElementById('infoPushName').textContent = data.pushName || '-';
    document.getElementById('infoConnected').textContent = data.connectedAt
      ? new Date(data.connectedAt).toLocaleString('id-ID', { timeZone: data.timezone })
      : '-';

    // toggle form pairing vs tombol hapus sesi
    const connected = data.status === 'connected';
    document.getElementById('pairingFormWrap').classList.toggle('hidden', connected);
    document.getElementById('pairingConnectedWrap').classList.toggle('hidden', !connected);
  } catch (e) { /* silent */ }
}
setInterval(refreshStatus, 5000);

socket.on('bot:tick', (data) => {
  const d = new Date(data.serverTime);
  const el = document.getElementById('statClock');
  if (el) el.textContent = d.toLocaleTimeString('id-ID', { hour12: false });
});
socket.on('bot:pairingCode', (code) => {
  const resultBox = document.getElementById('pairingResult');
  resultBox.classList.remove('hidden');
  resultBox.textContent = code;
});
socket.on('bot:status', refreshStatus);

// ---------- Pairing ----------
document.getElementById('pairingSubmit').addEventListener('click', async () => {
  const number = document.getElementById('pairingNumberInput').value.trim();
  if (!number) return;
  const res = await fetch('/api/pairing/request', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number })
  });
  const data = await res.json();
  const resultBox = document.getElementById('pairingResult');
  resultBox.classList.remove('hidden');
  resultBox.textContent = data.ok ? data.pairingCode : (data.message || 'Gagal');
});

// ---------- Load semua settings ke form ----------
let currentSettings = {};

async function loadAllSettings() {
  const res = await fetch('/api/settings');
  const data = await res.json();
  if (!data.ok) return;
  const s = currentSettings = data.settings;

  document.getElementById('setBotName').value = s.botName || '';
  document.getElementById('setPrefix').value = s.prefix || '.';
  document.getElementById('setOwners').value = (s.ownerNumbers || []).join(', ');
  document.getElementById('setTimezone').value = s.timezone || 'Asia/Jakarta';
  document.getElementById('setLanguage').value = s.language || 'id';
  document.getElementById('setSupport').value = s.supportContact || '';
  document.getElementById('setOwnerContact').value = s.ownerContact || '';
  document.getElementById('setPublicMode').checked = !!s.publicMode;

  document.getElementById('setMenuFooter').value = s.menuFooter || '';
  document.getElementById('setStickerPackname').value = s.stickerPackname || '';
  document.getElementById('setStickerAuthor').value = s.stickerAuthor || '';
  updateMediaPreview('image', s.menuImage);
  updateMediaPreview('audio', s.menuAudio);

  document.getElementById('setAntiSpam').checked = !!s.antiSpam;
  document.getElementById('setAntiLink').checked = !!s.antiLink;
  document.getElementById('setAntiToxic').checked = !!s.antiToxic;
  document.getElementById('setAntiCall').checked = !!s.antiCall;
  document.getElementById('setMaintenance').checked = !!s.maintenanceMode;
  document.getElementById('setRestrictGroups').checked = !!s.restrictToGroups;
  document.getElementById('setRestrictPrivate').checked = !!s.restrictToPrivate;

  document.getElementById('setAutoRead').checked = !!s.autoRead;
  document.getElementById('setAutoTyping').checked = !!s.autoTyping;
  document.getElementById('setAutoOnline').checked = !!s.autoOnline;
  document.getElementById('setMarkOnline').checked = !!s.markOnlineOnConnect;
  document.getElementById('setResponseDelay').value = s.responseDelayMs || 0;
  document.getElementById('setAutoBio').value = s.autoBio || '';

  document.getElementById('setDefaultLimit').value = s.defaultLimit || 99;
}

function updateMediaPreview(type, value) {
  const box = document.getElementById(type === 'image' ? 'imagePreview' : 'audioPreview');
  if (value) {
    box.classList.remove('hidden');
    if (type === 'image') document.getElementById('imagePreviewImg').src = value;
    else document.getElementById('audioPreviewName').textContent = value.split('/').pop();
  } else {
    box.classList.add('hidden');
  }
}

async function saveSection(patch, successId) {
  const res = await fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
  });
  const data = await res.json();
  document.getElementById(successId).textContent = data.ok ? '✅ Tersimpan.' : 'Gagal menyimpan.';
  setTimeout(() => { document.getElementById(successId).textContent = ''; }, 3000);
}

document.getElementById('saveGeneralBtn').addEventListener('click', () => saveSection({
  botName: document.getElementById('setBotName').value,
  prefix: document.getElementById('setPrefix').value,
  ownerNumbers: document.getElementById('setOwners').value.split(',').map((s) => s.trim()).filter(Boolean),
  timezone: document.getElementById('setTimezone').value,
  language: document.getElementById('setLanguage').value,
  supportContact: document.getElementById('setSupport').value,
  ownerContact: document.getElementById('setOwnerContact').value.replace(/\D/g, ''),
  publicMode: document.getElementById('setPublicMode').checked
}, 'generalSaved'));

document.getElementById('saveMenuBtn').addEventListener('click', () => saveSection({
  menuFooter: document.getElementById('setMenuFooter').value,
  stickerPackname: document.getElementById('setStickerPackname').value,
  stickerAuthor: document.getElementById('setStickerAuthor').value
}, 'menuSaved'));

document.getElementById('saveModerationBtn').addEventListener('click', () => saveSection({
  antiSpam: document.getElementById('setAntiSpam').checked,
  antiLink: document.getElementById('setAntiLink').checked,
  antiToxic: document.getElementById('setAntiToxic').checked,
  antiCall: document.getElementById('setAntiCall').checked,
  maintenanceMode: document.getElementById('setMaintenance').checked,
  restrictToGroups: document.getElementById('setRestrictGroups').checked,
  restrictToPrivate: document.getElementById('setRestrictPrivate').checked
}, 'moderationSaved'));

document.getElementById('saveBehaviorBtn').addEventListener('click', () => saveSection({
  autoRead: document.getElementById('setAutoRead').checked,
  autoTyping: document.getElementById('setAutoTyping').checked,
  autoOnline: document.getElementById('setAutoOnline').checked,
  markOnlineOnConnect: document.getElementById('setMarkOnline').checked,
  responseDelayMs: parseInt(document.getElementById('setResponseDelay').value, 10) || 0,
  autoBio: document.getElementById('setAutoBio').value
}, 'behaviorSaved'));

// ---------- Upload gambar/audio menu ----------
document.getElementById('uploadImageBtn').addEventListener('click', async () => {
  const file = document.getElementById('menuImageFile').files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('image', file);
  const res = await fetch('/api/upload/menu-image', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.ok) updateMediaPreview('image', data.path);
});
document.getElementById('removeImageBtn').addEventListener('click', async () => {
  await fetch('/api/upload/menu-image', { method: 'DELETE' });
  updateMediaPreview('image', '');
});
document.getElementById('uploadAudioBtn').addEventListener('click', async () => {
  const file = document.getElementById('menuAudioFile').files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('audio', file);
  const res = await fetch('/api/upload/menu-audio', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.ok) updateMediaPreview('audio', data.path);
});
document.getElementById('removeAudioBtn').addEventListener('click', async () => {
  await fetch('/api/upload/menu-audio', { method: 'DELETE' });
  updateMediaPreview('audio', '');
});

// ---------- Fitur / Plugin ----------
async function loadPluginList() {
  const res = await fetch('/api/plugins');
  const data = await res.json();
  const list = document.getElementById('pluginList');
  list.innerHTML = '';
  (data.files || []).forEach((file) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${file}</span>`;
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Hapus';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Hapus ${file}?`)) return;
      await fetch(`/api/plugins/${file}`, { method: 'DELETE' });
      loadPluginList();
    });
    li.appendChild(delBtn);
    list.appendChild(li);
  });
}

document.getElementById('saveFeatureBtn').addEventListener('click', async () => {
  const filename = document.getElementById('featureFilename').value.trim();
  const code = document.getElementById('featureCode').value;
  const res = await fetch('/api/plugins', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, code })
  });
  const data = await res.json();
  document.getElementById('featureSaved').textContent = data.ok ? `✅ ${data.message}` : (data.message || 'Gagal');
  if (data.ok) loadPluginList();
});

// ---------- Limit & VIP/Premium ----------
document.getElementById('saveLimitBtn').addEventListener('click', () => saveSection({
  defaultLimit: parseInt(document.getElementById('setDefaultLimit').value, 10) || 99
}, 'limitSaved'));

document.getElementById('addPremBtn').addEventListener('click', async () => {
  const number = document.getElementById('premNumber').value.trim();
  const days = parseInt(document.getElementById('premDays').value, 10) || 0;
  if (!number) return;
  const res = await fetch('/api/premium', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, days })
  });
  const data = await res.json();
  document.getElementById('premAdded').textContent = data.ok
    ? `✅ ${number} sekarang VIP (${days > 0 ? days + ' hari' : 'lifetime'}).`
    : (data.message || 'Gagal.');
  if (data.ok) { loadPremiumList(); document.getElementById('premNumber').value = ''; document.getElementById('premDays').value = ''; }
});

async function loadPremiumList() {
  const res = await fetch('/api/premium');
  const data = await res.json();
  const wrap = document.getElementById('premiumTableWrap');
  const entries = Object.entries(data.premium || {});
  if (!entries.length) { wrap.innerHTML = '<p class="muted">Belum ada user VIP/Premium.</p>'; return; }
  let html = '<table><tr><th>Nomor</th><th>Berlaku Sampai</th><th></th></tr>';
  for (const [number, p] of entries) {
    const exp = !p.expiresAt ? 'Lifetime' : new Date(p.expiresAt).toLocaleString('id-ID');
    html += `<tr><td>${number}</td><td>${exp}</td><td><button class="remove-btn" data-num="${number}">Hapus</button></td></tr>`;
  }
  html += '</table>';
  wrap.innerHTML = html;
  wrap.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/premium/${btn.dataset.num}`, { method: 'DELETE' });
      loadPremiumList();
    });
  });
}

// ---------- Users ----------
async function loadUsers() {
  const res = await fetch('/api/users');
  const data = await res.json();
  const wrap = document.getElementById('userTableWrap');
  const entries = Object.entries(data.users || {});
  if (!entries.length) { wrap.innerHTML = '<p class="muted">Belum ada user tercatat.</p>'; return; }
  let html = '<table><tr><th>Nomor</th><th>Pesan</th><th>Terakhir Aktif</th><th>Status</th></tr>';
  for (const [number, u] of entries) {
    html += `<tr><td>${number}</td><td>${u.messageCount || 0}</td><td>${new Date(u.lastSeen).toLocaleString('id-ID')}</td><td>${u.banned ? '🚫 Banned' : '✅ Aktif'}</td></tr>`;
  }
  html += '</table>';
  wrap.innerHTML = html;
}

// ---------- Hapus Sesi ----------
document.getElementById('deleteSessionBtn').addEventListener('click', async () => {
  if (!confirm('Yakin mau hapus sesi WhatsApp? Bot akan terputus dan perlu pairing ulang.')) return;
  const res = await fetch('/api/bot/logout', { method: 'POST' });
  const data = await res.json();
  document.getElementById('sessionDeleted').textContent = data.ok ? '✅ Sesi dihapus. Silakan pairing ulang.' : 'Gagal menghapus sesi.';
  if (data.ok) setTimeout(refreshStatus, 1000);
});

// ---------- Kelola Akun (khusus master) ----------
async function loadAccountsList() {
  const res = await fetch('/api/admin/accounts');
  const data = await res.json();
  const wrap = document.getElementById('accountsTableWrap');
  if (!data.ok) { wrap.innerHTML = '<p class="muted">Khusus akun master.</p>'; return; }
  if (!data.accounts.length) { wrap.innerHTML = '<p class="muted">Belum ada yang register.</p>'; return; }

  let html = '<table><tr><th>Username</th><th>Nama Bot</th><th>Status</th><th>Daftar Sejak</th><th></th></tr>';
  for (const acc of data.accounts) {
    const statusLabel = acc.status === 'connected' ? '🟢 Aktif' : acc.status === 'disconnected' ? '🔴 Belum terhubung' : '🟡 ' + acc.status;
    html += `<tr>
      <td>${acc.username}</td>
      <td>${acc.botName}</td>
      <td>${statusLabel}</td>
      <td>${new Date(acc.createdAt).toLocaleDateString('id-ID')}</td>
      <td><button class="remove-btn" data-id="${acc.id}">Hapus</button></td>
    </tr>`;
  }
  html += '</table>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Hapus akun "${btn.dataset.id}" beserta semua data & sesi bot-nya? Tindakan ini tidak bisa dibatalkan.`)) return;
      await fetch(`/api/admin/accounts/${btn.dataset.id}`, { method: 'DELETE' });
      loadAccountsList();
    });
  });
}
// ---------- Password ----------
document.getElementById('changePasswordBtn').addEventListener('click', async () => {
  const newPassword = document.getElementById('newPassword').value;
  const res = await fetch('/api/account/password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword })
  });
  const data = await res.json();
  document.getElementById('passwordChanged').textContent = data.ok ? '✅ Password diubah.' : (data.message || 'Gagal');
});
