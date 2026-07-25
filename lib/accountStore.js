const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const ACCOUNTS_PATH = path.join(__dirname, '..', 'data', 'accounts.json');

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function load() {
  fs.ensureFileSync(ACCOUNTS_PATH);
  try {
    const raw = fs.readFileSync(ACCOUNTS_PATH, 'utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function save(db) {
  fs.writeJsonSync(ACCOUNTS_PATH, db, { spaces: 2 });
}

function slugifyUsername(username) {
  return username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/** userId dipakai sebagai folder key untuk data/session/plugin milik user ini */
function register(username, password, phone, botName) {
  const db = load();
  const id = slugifyUsername(username);
  if (!id || id.length < 3) throw new Error('Username minimal 3 karakter, huruf/angka saja.');
  if (db[id]) throw new Error('Username sudah dipakai.');
  if (!password || password.length < 6) throw new Error('Password minimal 6 karakter.');
  if (phone && Object.values(db).some((a) => a.phone === phone)) throw new Error('Nomor WhatsApp ini sudah terdaftar.');

  db[id] = {
    id,
    username,
    phone,
    passwordHash: hashPassword(password),
    botName: botName || `Bot ${username}`,
    createdAt: Date.now()
  };
  save(db);
  return db[id];
}

function findByPhone(phone) {
  const db = load();
  return Object.values(db).find((a) => a.phone === phone) || null;
}

function verifyLogin(username, password) {
  const db = load();
  const id = slugifyUsername(username);
  const account = db[id];
  if (!account) return null;
  if (account.passwordHash !== hashPassword(password)) return null;
  return account;
}

function getAccount(userId) {
  const db = load();
  return db[userId] || null;
}

function updateAccount(userId, patch) {
  const db = load();
  if (!db[userId]) return null;
  db[userId] = { ...db[userId], ...patch };
  save(db);
  return db[userId];
}

function getAllAccounts() {
  return load();
}

function deleteAccount(userId) {
  const db = load();
  if (!db[userId]) return false;
  delete db[userId];
  save(db);
  return true;
}

module.exports = {
  hashPassword,
  slugifyUsername,
  register,
  verifyLogin,
  getAccount,
  updateAccount,
  getAllAccounts,
  findByPhone,
  deleteAccount
};
