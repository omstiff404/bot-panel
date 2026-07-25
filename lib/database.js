const fs = require('fs-extra');
const path = require('path');
const { normalizeNumber } = require('./jidHelper');

/**
 * PENTING soal performa: fungsi ini dipanggil di SETIAP pesan masuk lewat
 * handleMessage() di botManager.js (buat incrementMessageCount & isBanned).
 * Kalau baca/tulis file dari disk tiap kali (fs.readFileSync/writeFileSync itu
 * BLOCKING), seluruh proses Node — termasuk bot user lain & dashboard web —
 * ikut berhenti sesaat tiap ada pesan masuk. Makin ramai chat-nya, makin
 * kerasa lambat/nge-lag.
 *
 * Solusinya: simpan data di memori (cache), baca dari sana selama proses
 * masih hidup, dan tulis ke disk cuma sesekali (debounced), bukan tiap pesan.
 * Untuk aksi yang jarang terjadi (ban, set premium dari dashboard/command
 * owner) tetap ditulis LANGSUNG ke disk supaya tidak ada risiko kehilangan
 * perubahan penting kalau server mati mendadak.
 */

const cache = new Map(); // userId -> objek db (referensi langsung, bukan copy)
const dirtyUsers = new Set();
let flushTimer = null;
const FLUSH_INTERVAL_MS = 10000;

function dbPath(userId) {
  return path.join(__dirname, '..', 'data', userId, 'users.json');
}

function load(userId) {
  if (cache.has(userId)) return cache.get(userId);
  const p = dbPath(userId);
  fs.ensureFileSync(p);
  let data = {};
  try {
    const raw = fs.readFileSync(p, 'utf-8').trim();
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    data = {};
  }
  cache.set(userId, data);
  return data;
}

function persist(userId) {
  const data = cache.get(userId);
  if (!data) return;
  fs.writeJsonSync(dbPath(userId), data, { spaces: 2 });
  dirtyUsers.delete(userId);
}

/** Tulis langsung ke disk — dipakai untuk aksi jarang (ban, premium, dll) */
function saveImmediate(userId) {
  persist(userId);
}

/** Tandai perlu ditulis, tapi nanti (batched) — dipakai di hot-path per-pesan */
function scheduleFlush(userId) {
  dirtyUsers.add(userId);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    for (const id of dirtyUsers) persist(id);
  }, FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref(); // jangan sampai nahan proses exit gara-gara timer ini
}

function keyOf(numberOrJid) {
  return normalizeNumber(numberOrJid.split('@')[0]) || numberOrJid;
}

function upsertUser(userId, numberOrJid, patch = {}) {
  const db = load(userId);
  const key = keyOf(numberOrJid);
  db[key] = {
    ...(db[key] || { firstSeen: Date.now(), messageCount: 0, banned: false }),
    ...patch,
    lastSeen: Date.now()
  };
  saveImmediate(userId); // aksi manual (ban/premium/dll), langsung tulis
  return db[key];
}

/** Dipanggil di SETIAP pesan masuk — jangan tulis ke disk di sini, cuma update memori */
function incrementMessageCount(userId, numberOrJid) {
  const db = load(userId);
  const key = keyOf(numberOrJid);
  const existing = db[key] || { firstSeen: Date.now(), messageCount: 0, banned: false };
  existing.messageCount = (existing.messageCount || 0) + 1;
  existing.lastSeen = Date.now();
  db[key] = existing;
  scheduleFlush(userId); // tulis ke disk nanti, di-batch bareng pesan lain
  return existing;
}

function getAllUsers(userId) {
  return load(userId);
}

function totalUsers(userId) {
  return Object.keys(load(userId)).length;
}

function isBanned(userId, numberOrJid) {
  const db = load(userId);
  return !!db[keyOf(numberOrJid)]?.banned;
}

function setBanned(userId, numberOrJid, banned = true) {
  return upsertUser(userId, numberOrJid, { banned });
}

// ---------------- LIMIT & VIP/PREMIUM ----------------

function isPremiumActive(userId, numberOrJid) {
  const db = load(userId);
  const premium = db[keyOf(numberOrJid)]?.premium;
  if (!premium) return false;
  if (premium.expiresAt === null || premium.expiresAt === undefined) return true;
  return premium.expiresAt > Date.now();
}

function getPremiumInfo(userId, numberOrJid) {
  const db = load(userId);
  return db[keyOf(numberOrJid)]?.premium || null;
}

function setPremium(userId, numberOrJid, durationDays = 0) {
  const expiresAt = durationDays && durationDays > 0
    ? Date.now() + durationDays * 24 * 60 * 60 * 1000
    : null;
  return upsertUser(userId, numberOrJid, { premium: { expiresAt, addedAt: Date.now(), durationDays } });
}

function removePremium(userId, numberOrJid) {
  const db = load(userId);
  const key = keyOf(numberOrJid);
  if (db[key]) {
    delete db[key].premium;
    saveImmediate(userId);
  }
}

function getAllPremium(userId) {
  const db = load(userId);
  const result = {};
  for (const [key, u] of Object.entries(db)) {
    if (u.premium && (u.premium.expiresAt === null || u.premium.expiresAt > Date.now())) {
      result[key] = u.premium;
    }
  }
  return result;
}

/**
 * Cek & konsumsi limit harian — ini juga di hot-path (dipanggil tiap ada yang
 * pakai command ber-limit), jadi pakai scheduleFlush juga, bukan tulis langsung.
 */
function checkAndConsumeLimit(userId, numberOrJid, defaultLimit = 99, resetHours = 24) {
  const db = load(userId);
  const key = keyOf(numberOrJid);
  const now = Date.now();
  const existing = db[key] || { firstSeen: now, messageCount: 0, banned: false };

  if (!existing.limitResetAt || existing.limitResetAt <= now) {
    existing.limitUsed = 0;
    existing.limitResetAt = now + resetHours * 60 * 60 * 1000;
  }
  existing.limitUsed = existing.limitUsed || 0;

  if (existing.limitUsed >= defaultLimit) {
    db[key] = existing;
    scheduleFlush(userId);
    return { allowed: false, remaining: 0, limit: defaultLimit };
  }

  existing.limitUsed += 1;
  existing.lastSeen = now;
  db[key] = existing;
  scheduleFlush(userId);
  return { allowed: true, remaining: defaultLimit - existing.limitUsed, limit: defaultLimit };
}

function getRemainingLimit(userId, numberOrJid, defaultLimit = 99, resetHours = 24) {
  const db = load(userId);
  const key = keyOf(numberOrJid);
  const now = Date.now();
  const existing = db[key];
  if (!existing || !existing.limitResetAt || existing.limitResetAt <= now) {
    return { remaining: defaultLimit, limit: defaultLimit, resetAt: null };
  }
  return {
    remaining: Math.max(0, defaultLimit - (existing.limitUsed || 0)),
    limit: defaultLimit,
    resetAt: existing.limitResetAt
  };
}

/** Paksa tulis semua data yang masih tertunda ke disk — dipanggil saat server mau shutdown */
function flushAllPending() {
  for (const id of dirtyUsers) persist(id);
}

module.exports = {
  upsertUser,
  incrementMessageCount,
  getAllUsers,
  totalUsers,
  isBanned,
  setBanned,
  isPremiumActive,
  getPremiumInfo,
  setPremium,
  removePremium,
  getAllPremium,
  checkAndConsumeLimit,
  getRemainingLimit,
  flushAllPending
};
