const socket = io();

// ---------- Sidebar ----------
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const burgerBtn = document.getElementById('burgerBtn');

function openSidebar() { sidebar.classList.add('open'); overlay.classList.add('show'); }
function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('show'); }
burgerBtn.addEventListener('click', () => sidebar.classList.contains('open') ? closeSidebar() : openSidebar());
overlay.addEventListener('click', closeSidebar);

document.querySelectorAll('.nav-item[data-panel]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item[data-panel]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    document.getElementById(`panel-${btn.dataset.panel}`).classList.add('active');
    closeSidebar();
  });
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
document.body.setAttribute('data-ui-theme', localStorage.getItem('wa-ui-theme') || 'default');

// ---------- Auth-aware sidebar slot + mode pilihan endpoint ----------
let isLoggedIn = false;

async function setupAuthState() {
  const res = await fetch('/api/session');
  const data = await res.json();
  isLoggedIn = !!data.loggedIn;

  const slot = document.getElementById('authNavSlot');
  const ctaRegister = document.getElementById('ctaRegister');
  const modeLabel = document.getElementById('homeModeLabel');

  if (isLoggedIn) {
    slot.innerHTML = `
      <a class="nav-item nav-link" href="/settings.html">⚙️ Pengaturan</a>
      <button class="nav-item" id="sidebarLogoutBtn">🚪 Logout</button>
    `;
    document.getElementById('sidebarLogoutBtn').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.reload();
    });
    ctaRegister.classList.add('hidden');
    modeLabel.textContent = `Halo, ${data.username} — ini bot kamu:`;
  } else {
    slot.innerHTML = `<a class="nav-item nav-link" href="/login.html">🔐 Login</a>`;
    ctaRegister.classList.remove('hidden');
    modeLabel.textContent = 'Bot demo (master) — daftar untuk punya bot sendiri:';
  }

  refreshStatus();
}

// ---------- Status ----------
function formatUptime(sec) {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}h ${h}j ${m}m`;
}

async function refreshStatus() {
  try {
    const endpoint = isLoggedIn ? '/api/status' : '/api/public-status';
    const res = await fetch(endpoint);
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
      disconnected: '🔴 Belum terhubung'
    };
    statusText.textContent = statusLabel[data.status] || data.status;

    if (data.profilePicUrl) document.getElementById('botAvatar').src = data.profilePicUrl;

    document.getElementById('statRuntime').textContent = formatUptime(data.uptimeSeconds);
    document.getElementById('statFeatures').textContent = data.totalFeatures;
    document.getElementById('statUsers').textContent = data.totalUsers;
    document.getElementById('statRegistered').textContent = data.totalRegistered ?? 0;

    // nomor bot selalu disamarkan dari server, tidak pernah ditampilkan utuh
    document.getElementById('infoNumber').textContent = data.number || 'Belum terhubung';
    document.getElementById('infoPushName').textContent = data.pushName || '-';
    document.getElementById('infoTimezone').textContent = data.timezone || 'Asia/Jakarta';

    document.getElementById('supportLink').href = data.supportContact || '#';
  } catch (e) { /* silent */ }
}

setupAuthState();
setInterval(refreshStatus, 5000);

socket.on('bot:tick', (data) => {
  const d = new Date(data.serverTime);
  document.getElementById('statClock').textContent = d.toLocaleTimeString('id-ID', { hour12: false });
});
socket.on('bot:status', refreshStatus);
socket.on('bot:pairingCode', refreshStatus);
