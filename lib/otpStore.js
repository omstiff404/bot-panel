const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const OTP_PATH = path.join(__dirname, '..', 'data', 'otp.json');
const OTP_TTL_MS = 5 * 60 * 1000; // 5 menit

function load() {
  fs.ensureFileSync(OTP_PATH);
  try {
    const raw = fs.readFileSync(OTP_PATH, 'utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function save(db) {
  fs.writeJsonSync(OTP_PATH, db, { spaces: 2 });
}

function generateOtp(phone) {
  const db = load();
  const code = crypto.randomInt(100000, 999999).toString();
  db[phone] = { code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 };
  save(db);
  return code;
}

function verifyOtp(phone, code) {
  const db = load();
  const entry = db[phone];
  if (!entry) return { ok: false, message: 'Kode belum diminta atau sudah kadaluarsa.' };
  if (Date.now() > entry.expiresAt) {
    delete db[phone];
    save(db);
    return { ok: false, message: 'Kode sudah kadaluarsa, minta kode baru.' };
  }
  entry.attempts += 1;
  if (entry.attempts > 5) {
    delete db[phone];
    save(db);
    return { ok: false, message: 'Terlalu banyak percobaan, minta kode baru.' };
  }
  if (entry.code !== String(code).trim()) {
    save(db);
    return { ok: false, message: 'Kode salah.' };
  }
  delete db[phone];
  save(db);
  return { ok: true };
}

module.exports = { generateOtp, verifyOtp };
