const express = require('express');
const session = require('express-session');
const sharedSession = require('express-socket.io-session');
const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const { Server } = require('socket.io');
const moment = require('moment-timezone');

const { getSettings, saveSettings } = require('../config');
const botManager = require('../lib/botManager');
const { loadPlugins, listPluginFiles, seedDefaultPlugins, pluginDir, totalFeatures, invalidatePluginCache } = require('../lib/pluginLoader');
const db = require('../lib/database');
const accountStore = require('../lib/accountStore');
const otpStore = require('../lib/otpStore');
const { normalizeNumber } = require('../lib/jidHelper');

const PORT = process.env.PORT || 3000;
const MASTER_USER_ID = global.WA_BOT.MASTER_USER_ID;

/** Sembunyikan nomor bot: tampilkan cuma 4 digit depan + 3 digit belakang */
function maskNumber(number) {
  if (!number) return null;
  const str = String(number);
  if (str.length <= 7) return '*'.repeat(str.length);
  return `${str.slice(0, 4)}${'*'.repeat(str.length - 7)}${str.slice(-3)}`;
}

function requireLogin(req, res, next) {
  if (req.session?.userId && accountStore.getAccount(req.session.userId)) return next();
  return res.status(401).json({ ok: false, message: 'Belum login.' });
}

function requireMaster(req, res, next) {
  if (req.session?.userId === MASTER_USER_ID) return next();
  return res.status(403).json({ ok: false, message: 'Khusus akun master.' });
}

async function startWebServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  const sessionMiddleware = session({
    secret: '0eb11876ed46dce428ba5219d9e1f3dcd0cf00eec3d6fb3044c2e7b92c8d53da',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
  });

  app.use(express.json());
  app.use(sessionMiddleware);
  app.use(express.static(path.join(__dirname, 'public')));

  // socket.io berbagi session yang sama dengan express, supaya room per-user aman
  // (tidak bisa asal join room orang lain karena harus login dulu).
  io.use(sharedSession(sessionMiddleware, { autoSave: true }));
  io.on('connection', (socket) => {
    const userId = socket.handshake.session?.userId;
    if (userId) {
      socket.join(userId);
      socket.emit('bot:status', botManager.getState(userId));
    }
  });

  // tick jam real-time (broadcast global karena cuma teks waktu, tidak sensitif)
  setInterval(() => {
    io.emit('bot:tick', { serverTime: moment().tz('Asia/Jakarta').format() });
  }, 1000);

  // ---------- REGISTRASI (verifikasi via WhatsApp, BUKAN email) ----------
  app.post('/api/register/request-otp', async (req, res) => {
    const phone = normalizeNumber(req.body?.phone);
    if (!phone) return res.status(400).json({ ok: false, message: 'Nomor WhatsApp tidak valid.' });
    if (accountStore.findByPhone(phone)) {
      return res.status(400).json({ ok: false, message: 'Nomor ini sudah terdaftar. Silakan login.' });
    }

    const masterState = botManager.getState(MASTER_USER_ID);
    const masterSock = botManager.getSock(MASTER_USER_ID);
    if (masterState.status !== 'connected' || !masterSock) {
      return res.status(503).json({
        ok: false,
        message: 'Bot verifikasi belum aktif. Hubungi admin untuk menyalakan bot verifikasi dulu.'
      });
    }

    const code = otpStore.generateOtp(phone);
    try {
      await masterSock.sendMessage(`${phone}@s.whatsapp.net`, {
        text: `🔐 Kode verifikasi pendaftaran bot kamu: *${code}*\nBerlaku 5 menit. Jangan bagikan kode ini ke siapapun.`
      });
      res.json({ ok: true, message: 'Kode verifikasi dikirim ke WhatsApp kamu.' });
    } catch (err) {
      res.status(500).json({ ok: false, message: 'Gagal mengirim pesan WhatsApp. Coba lagi.' });
    }
  });

  app.post('/api/register', async (req, res) => {
    const { username, password, phone: rawPhone, otp, botName } = req.body || {};
    const phone = normalizeNumber(rawPhone);
    if (!phone) return res.status(400).json({ ok: false, message: 'Nomor WhatsApp tidak valid.' });

    const check = otpStore.verifyOtp(phone, otp);
    if (!check.ok) return res.status(400).json({ ok: false, message: check.message });

    try {
      const account = accountStore.register(username, password, phone, botName);
      seedDefaultPlugins(account.id);
      req.session.userId = account.id;
      res.json({ ok: true, userId: account.id });
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message });
    }
  });

  // ---------- LOGIN ----------
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    const account = accountStore.verifyLogin(username || '', password || '');
    if (!account) return res.status(401).json({ ok: false, message: 'Username atau password salah.' });
    req.session.userId = account.id;
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/api/session', (req, res) => {
    const account = req.session?.userId ? accountStore.getAccount(req.session.userId) : null;
    res.json({ ok: true, loggedIn: !!account, username: account?.username || null });
  });

  // ---------- STATUS BOT MASTER (publik, tanpa login — buat halaman beranda) ----------
  app.get('/api/public-status', (req, res) => {
    const settings = getSettings(MASTER_USER_ID);
    const state = botManager.getState(MASTER_USER_ID);
    const totalRegistered = Object.keys(accountStore.getAllAccounts()).filter((id) => id !== MASTER_USER_ID).length;

    res.json({
      ok: true,
      botName: settings.botName,
      status: state.status,
      number: maskNumber(state.number),
      pushName: state.pushName,
      profilePicUrl: state.profilePicUrl,
      uptimeSeconds: process.uptime(),
      totalFeatures: totalFeatures(MASTER_USER_ID),
      totalUsers: db.totalUsers(MASTER_USER_ID),
      totalRegistered,
      timezone: settings.timezone,
      serverTime: moment().tz(settings.timezone || 'Asia/Jakarta').format(),
      supportContact: settings.supportContact
    });
  });

  // ---------- STATUS BOT (punya user yang login) ----------
  app.get('/api/status', requireLogin, (req, res) => {
    const userId = req.session.userId;
    const account = accountStore.getAccount(userId);
    const settings = getSettings(userId);
    const state = botManager.getState(userId);
    const totalRegistered = Object.keys(accountStore.getAllAccounts()).filter((id) => id !== MASTER_USER_ID).length;

    res.json({
      ok: true,
      botName: settings.botName,
      status: state.status,
      pairingCode: state.pairingCode,
      connectedAt: state.connectedAt,
      uptimeSeconds: process.uptime(),
      number: maskNumber(state.number), // nomor bot disembunyikan (masking), bukan ditampilkan utuh
      pushName: state.pushName,
      profilePicUrl: state.profilePicUrl,
      totalFeatures: totalFeatures(userId),
      totalUsers: db.totalUsers(userId),
      totalRegistered,
      timezone: settings.timezone,
      serverTime: moment().tz(settings.timezone || 'Asia/Jakarta').format(),
      theme: settings.theme,
      supportContact: settings.supportContact,
      accountUsername: account?.username
    });
  });

  // ---------- SETTINGS ----------
  app.get('/api/settings', requireLogin, (req, res) => {
    const settings = getSettings(req.session.userId);
    res.json({ ok: true, settings });
  });

  app.post('/api/settings', requireLogin, (req, res) => {
    const patch = req.body || {};
    const updated = saveSettings(req.session.userId, patch);
    res.json({ ok: true, settings: updated });
  });

  // ---------- AKUN (password bisa diubah, username tidak karena jadi ID folder data) ----------
  app.post('/api/account/password', requireLogin, (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ ok: false, message: 'Password minimal 6 karakter.' });
    }
    accountStore.updateAccount(req.session.userId, { passwordHash: accountStore.hashPassword(newPassword) });
    res.json({ ok: true });
  });

  // ---------- PAIRING CODE ----------
  app.post('/api/pairing/request', requireLogin, async (req, res) => {
    const userId = req.session.userId;
    const { number } = req.body || {};
    if (!number) return res.status(400).json({ ok: false, message: 'Nomor wajib diisi.' });

    // Kalau sudah terhubung, jangan izinkan minta pairing baru — harus hapus sesi dulu
    const currentState = botManager.getState(userId);
    if (currentState.status === 'connected') {
      return res.status(400).json({ ok: false, message: 'Bot sudah terhubung. Hapus sesi dulu kalau mau ganti nomor.' });
    }

    saveSettings(userId, { pairingNumber: number, usePairingCode: true });

    try {
      await botManager.startBotForUser(userId, io);
      // beri waktu socket siap sebelum request pairing code (baru pertama kali start)
      await new Promise((r) => setTimeout(r, 500));
      const sock = botManager.getSock(userId);
      if (!sock) return res.status(400).json({ ok: false, message: 'Socket belum siap, coba lagi sebentar.' });

      const code = await sock.requestPairingCode(number.replace(/\D/g, ''));
      const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
      io.to(userId).emit('bot:pairingCode', formatted);
      res.json({ ok: true, pairingCode: formatted });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // Hapus sesi WhatsApp (logout) supaya bisa pairing ulang dari nol dengan nomor lain
  app.post('/api/bot/logout', requireLogin, async (req, res) => {
    const userId = req.session.userId;
    await botManager.logoutAndDeleteSession(userId);
    saveSettings(userId, { pairingNumber: '' });
    io.to(userId).emit('bot:status', botManager.getState(userId));
    res.json({ ok: true });
  });

  // ---------- UPLOAD gambar & musik menu (per-user folder) ----------
  const UPLOAD_ROOT = path.join(__dirname, 'public', 'uploads');
  fs.ensureDirSync(UPLOAD_ROOT);

  function userUploadDir(userId) {
    const dir = path.join(UPLOAD_ROOT, userId);
    fs.ensureDirSync(dir);
    return dir;
  }

  const imageUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, userUploadDir(req.session.userId)),
      filename: (req, file, cb) => cb(null, 'menu-image' + path.extname(file.originalname || '.jpg'))
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
  });

  const audioUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, userUploadDir(req.session.userId)),
      filename: (req, file, cb) => cb(null, 'menu-audio' + path.extname(file.originalname || '.mp3'))
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /^audio\//.test(file.mimetype))
  });

  app.post('/api/upload/menu-image', requireLogin, imageUpload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, message: 'File gambar tidak valid.' });
    const relativePath = `/uploads/${req.session.userId}/${req.file.filename}`;
    saveSettings(req.session.userId, { menuImage: relativePath });
    res.json({ ok: true, path: relativePath });
  });

  app.post('/api/upload/menu-audio', requireLogin, audioUpload.single('audio'), (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, message: 'File audio tidak valid.' });
    const relativePath = `/uploads/${req.session.userId}/${req.file.filename}`;
    saveSettings(req.session.userId, { menuAudio: relativePath });
    res.json({ ok: true, path: relativePath });
  });

  app.delete('/api/upload/menu-image', requireLogin, (req, res) => {
    const settings = getSettings(req.session.userId);
    if (settings.menuImage) fs.removeSync(path.join(__dirname, 'public', settings.menuImage));
    saveSettings(req.session.userId, { menuImage: '' });
    res.json({ ok: true });
  });

  app.delete('/api/upload/menu-audio', requireLogin, (req, res) => {
    const settings = getSettings(req.session.userId);
    if (settings.menuAudio) fs.removeSync(path.join(__dirname, 'public', settings.menuAudio));
    saveSettings(req.session.userId, { menuAudio: '' });
    res.json({ ok: true });
  });

  // ---------- PLUGIN MANAGEMENT (per-user) ----------
  app.get('/api/plugins', requireLogin, (req, res) => {
    res.json({ ok: true, files: listPluginFiles(req.session.userId) });
  });

  app.get('/api/plugins/:file', requireLogin, (req, res) => {
    const filePath = path.join(pluginDir(req.session.userId), path.basename(req.params.file));
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false });
    res.json({ ok: true, content: fs.readFileSync(filePath, 'utf-8') });
  });

  app.post('/api/plugins', requireLogin, (req, res) => {
    const { filename, code } = req.body || {};
    if (!filename || !code) return res.status(400).json({ ok: false, message: 'filename & code wajib diisi.' });
    if (!filename.endsWith('.js') || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ ok: false, message: 'Nama file tidak valid.' });
    }
    const filePath = path.join(pluginDir(req.session.userId), filename);
    fs.writeFileSync(filePath, code, 'utf-8');
    invalidatePluginCache(req.session.userId);
    res.json({ ok: true, message: `Fitur ${filename} tersimpan & otomatis termuat.` });
  });

  app.delete('/api/plugins/:file', requireLogin, (req, res) => {
    const filePath = path.join(pluginDir(req.session.userId), path.basename(req.params.file));
    if (fs.existsSync(filePath)) fs.removeSync(filePath);
    invalidatePluginCache(req.session.userId);
    res.json({ ok: true });
  });

  // ---------- USERS (chat user milik bot ini) ----------
  app.get('/api/users', requireLogin, (req, res) => {
    res.json({ ok: true, users: db.getAllUsers(req.session.userId) });
  });

  // ---------- LIMIT & VIP/PREMIUM ----------
  app.get('/api/premium', requireLogin, (req, res) => {
    res.json({ ok: true, premium: db.getAllPremium(req.session.userId), defaultLimit: getSettings(req.session.userId).defaultLimit });
  });

  app.post('/api/premium', requireLogin, (req, res) => {
    const { number, days } = req.body || {};
    if (!number) return res.status(400).json({ ok: false, message: 'Nomor wajib diisi.' });
    db.setPremium(req.session.userId, number, parseInt(days, 10) || 0);
    res.json({ ok: true });
  });

  app.delete('/api/premium/:number', requireLogin, (req, res) => {
    db.removePremium(req.session.userId, req.params.number);
    res.json({ ok: true });
  });

  // ---------- KELOLA AKUN (khusus master) ----------
  app.get('/api/admin/accounts', requireLogin, requireMaster, (req, res) => {
    const accounts = accountStore.getAllAccounts();
    const list = Object.values(accounts)
      .filter((a) => a.id !== MASTER_USER_ID)
      .map((a) => ({
        id: a.id,
        username: a.username,
        botName: a.botName,
        createdAt: a.createdAt,
        status: botManager.getState(a.id).status
      }));
    res.json({ ok: true, accounts: list });
  });

  app.delete('/api/admin/accounts/:userId', requireLogin, requireMaster, async (req, res) => {
    const targetId = req.params.userId;
    if (targetId === MASTER_USER_ID) {
      return res.status(400).json({ ok: false, message: 'Tidak bisa menghapus akun master.' });
    }
    if (!accountStore.getAccount(targetId)) {
      return res.status(404).json({ ok: false, message: 'Akun tidak ditemukan.' });
    }

    botManager.stopBotForUser(targetId);
    accountStore.deleteAccount(targetId);

    try { fs.removeSync(path.join(__dirname, '..', 'data', targetId)); } catch (_) {}
    try { fs.removeSync(botManager.sessionDir(targetId)); } catch (_) {}
    try { fs.removeSync(path.join(__dirname, 'public', 'uploads', targetId)); } catch (_) {}

    res.json({ ok: true });
  });

  server.listen(PORT, () => {
    console.log(`🌐 Dashboard berjalan di http://localhost:${PORT}`);
  });

  return { app, server, io };
}

module.exports = { startWebServer };
