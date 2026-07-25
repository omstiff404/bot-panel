const fs = require('fs-extra');
const path = require('path');

// Cache di memori: getSettings() dipanggil di SETIAP pesan masuk (lewat handleMessage),
// jadi kalau baca file tiap kali itu bikin seluruh proses Node blocking berulang-ulang.
// Cache di-invalidate otomatis tiap kali saveSettings() dipanggil.
const settingsCache = new Map();

function settingsPath(userId) {
  return path.join(__dirname, 'data', userId, 'settings.json');
}

/**
 * Default settings untuk BOT MASING-MASING USER. Setiap user yang register
 * dapat salinan default ini di data/<userId>/settings.json, lalu bisa diubah
 * sendiri lewat dashboard mereka.
 */
const DEFAULTS = {
  botName: 'Bot WA 2026',
  ownerNumbers: [],             // owner bot ini = nomor si pemilik akun sendiri (diisi saat pairing pertama kali)
  prefix: '.',
  timezone: 'Asia/Jakarta',
  pairingNumber: '',
  usePairingCode: true,
  browser: ['Ubuntu', 'Chrome', '20.0.04'],
  autoRead: false,
  autoTyping: false,
  autoOnline: true,
  publicMode: true,
  antiSpam: true,
  theme: 'dark',
  supportContact: 'https://omstiff.edgeone.app',
  ownerContact: '6283879685072',

  defaultLimit: 99,
  limitResetHours: 24,

  menuImage: '',
  menuAudio: '',
  menuFooter: 'Bot WA 2026 - Powered by Baileys',
  menuStyle: 'list',

  stickerPackname: 'WA Bot 2026',
  stickerAuthor: 'Dashboard',

  antiLink: false,
  antiToxic: false,
  antiCall: true,
  restrictToGroups: false,
  restrictToPrivate: false,
  maintenanceMode: false,

  responseDelayMs: 0,
  markOnlineOnConnect: true,
  autoBio: '',

  language: 'id'
};

function ensureSettingsFile(userId) {
  const p = settingsPath(userId);
  fs.ensureDirSync(path.dirname(p));
  if (!fs.existsSync(p)) {
    fs.writeJsonSync(p, DEFAULTS, { spaces: 2 });
  }
}

function getSettings(userId) {
  if (settingsCache.has(userId)) return settingsCache.get(userId);
  ensureSettingsFile(userId);
  const current = fs.readJsonSync(settingsPath(userId));
  const merged = { ...DEFAULTS, ...current };
  settingsCache.set(userId, merged);
  return merged;
}

function saveSettings(userId, patch) {
  const current = getSettings(userId);
  const merged = { ...current, ...patch };
  fs.writeJsonSync(settingsPath(userId), merged, { spaces: 2 });
  settingsCache.set(userId, merged); // update cache juga, bukan cuma file
  return merged;
}

module.exports = { getSettings, saveSettings, settingsPath, DEFAULTS };
