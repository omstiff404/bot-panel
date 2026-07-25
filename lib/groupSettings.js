const fs = require('fs-extra');
const path = require('path');

function dbPath(userId) {
  return path.join(__dirname, '..', 'data', userId, 'groups.json');
}

function load(userId) {
  const p = dbPath(userId);
  fs.ensureFileSync(p);
  try {
    const raw = fs.readFileSync(p, 'utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function save(userId, db) {
  fs.writeJsonSync(dbPath(userId), db, { spaces: 2 });
}

/**
 * Satu-satunya kontrol welcome/leave (khusus admin grup lewat .setwelcome / .setleave).
 * Default welcome & leave = true kalau belum pernah diatur.
 */
function getGroupSettings(userId, groupJid) {
  const db = load(userId);
  return { welcome: true, leave: true, ...(db[groupJid] || {}) };
}

function setGroupSetting(userId, groupJid, key, value) {
  const db = load(userId);
  db[groupJid] = { ...(db[groupJid] || {}), [key]: value };
  save(userId, db);
  return db[groupJid];
}

module.exports = { getGroupSettings, setGroupSetting };
