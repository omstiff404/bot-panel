const fs = require('fs-extra');
const path = require('path');

// isStale() dicek di SETIAP pesan grup masuk (buat auto-deteksi grup), jadi harus
// baca dari memori, bukan disk. Pola sama seperti database.js: cache + debounced flush.
const cache = new Map(); // userId -> objek db grup
const dirtyUsers = new Set();
let flushTimer = null;
const FLUSH_INTERVAL_MS = 10000;

function dbPath(userId) {
  return path.join(__dirname, '..', 'data', userId, 'group-cache.json');
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

function scheduleFlush(userId) {
  dirtyUsers.add(userId);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    for (const id of dirtyUsers) persist(id);
  }, FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref();
}

function getGroup(userId, groupJid) {
  const db = load(userId);
  return db[groupJid] || null;
}

/**
 * Pengaturan per-grup. Ini SATU-SATUNYA kontrol welcome/leave (tidak ada saklar global) —
 * hanya admin grup yang bisa mengubah lewat .setwelcome / .setleave.
 * Default welcome & leave = true (aktif) kalau belum pernah diatur.
 */
function saveGroup(userId, groupJid, metadata) {
  const db = load(userId);
  db[groupJid] = {
    subject: metadata.subject || db[groupJid]?.subject || groupJid,
    participants: (metadata.participants || []).map((p) => p.id || p.jid).filter(Boolean),
    updatedAt: Date.now()
  };
  scheduleFlush(userId); // dipanggil dari hot-path (auto-deteksi), jangan tulis langsung
  return db[groupJid];
}

function isStale(userId, groupJid, maxAgeMs = 30 * 60 * 1000) {
  const g = getGroup(userId, groupJid); // dari memori (cache), bukan baca file
  return !g || Date.now() - g.updatedAt > maxAgeMs;
}

function addParticipant(userId, groupJid, participantJid) {
  const db = load(userId);
  const g = db[groupJid];
  if (!g) return;
  if (!g.participants.includes(participantJid)) g.participants.push(participantJid);
  scheduleFlush(userId);
}

function removeParticipant(userId, groupJid, participantJid) {
  const db = load(userId);
  const g = db[groupJid];
  if (!g) return;
  g.participants = g.participants.filter((p) => p !== participantJid);
  scheduleFlush(userId);
}

function getAllGroups(userId) {
  return load(userId);
}

function flushAllPending() {
  for (const id of dirtyUsers) persist(id);
}

module.exports = {
  getGroup,
  saveGroup,
  isStale,
  addParticipant,
  removeParticipant,
  getAllGroups,
  flushAllPending
};
