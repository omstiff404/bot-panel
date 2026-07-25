/**
 * jidHelper.js
 * -----------------------------------------------------------------------
 * Baileys 7.x memperkenalkan @lid (Linked/Local ID) yang menggantikan
 * @s.whatsapp.net (PN JID) di banyak event, terutama untuk akun dengan
 * privasi nomor telepon aktif dan komunitas/grup besar.
 *
 * Masalah umum:
 *   - Owner set nomor "628xxxx" di config, tapi pesan owner datang sebagai
 *     "123456789@lid" -> bot anggap orang lain -> command owner ditolak.
 *   - Di grup, sender.participant bisa berupa LID sedangkan daftar admin
 *     grup (dari groupMetadata lama) berbasis PN, atau sebaliknya.
 *
 * Solusi di file ini:
 *   1. Selalu kumpulkan SEMUA representasi identitas pengirim yang tersedia
 *      dalam satu pesan: remoteJid, remoteJidAlt, participant, participantAlt,
 *      key.senderPn (kalau ada), lalu resolve lewat sock.signalRepository.lidMapping.
 *   2. Normalisasi nomor (buang karakter non-digit, buang leading 0/+).
 *   3. Bandingkan berdasarkan KUMPULAN identitas, bukan satu string.
 *   4. Cache mapping LID<->PN di memori supaya tidak query berulang.
 * -----------------------------------------------------------------------
 */

const cacheLidToPn = new Map();
const cachePnToLid = new Map();

function onlyDigits(str) {
  if (!str) return '';
  return String(str).replace(/\D/g, '');
}

function isLidJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@lid');
}
function isPnJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
}
function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

/** Ambil bagian angka murni dari jid apapun bentuknya (lid/pn/nomor mentah) */
function rawId(jid) {
  if (!jid) return '';
  const withoutSuffix = jid.split('@')[0].split(':')[0];
  return onlyDigits(withoutSuffix);
}

/**
 * Normalisasi nomor telepon mentah dari user/config supaya konsisten,
 * misal "+62 812-3456-789", "0812xxxx", "62812xxxx" -> "62812xxxx"
 */
function normalizeNumber(input) {
  let digits = onlyDigits(input);
  if (!digits) return null;
  if (digits.startsWith('0')) digits = '62' + digits.slice(1); // asumsi default Indonesia
  return digits;
}

/**
 * Resolve PN <-> LID lewat signalRepository bawaan Baileys 7,
 * dengan cache lokal supaya hemat lookup.
 */
async function resolvePN(sock, lid) {
  if (!isLidJid(lid)) return lid;
  if (cacheLidToPn.has(lid)) return cacheLidToPn.get(lid);
  try {
    const pn = await sock.signalRepository.lidMapping.getPNForLID(lid);
    if (pn) {
      cacheLidToPn.set(lid, pn);
      cachePnToLid.set(pn, lid);
      return pn;
    }
  } catch (_) {}
  return null;
}

async function resolveLID(sock, pn) {
  if (!isPnJid(pn)) return pn;
  if (cachePnToLid.has(pn)) return cachePnToLid.get(pn);
  try {
    const lid = await sock.signalRepository.lidMapping.getLIDForPN(pn);
    if (lid) {
      cachePnToLid.set(pn, lid);
      cacheLidToPn.set(lid, pn);
      return lid;
    }
  } catch (_) {}
  return null;
}

/** Simpan mapping manual (dipanggil saat event 'lid-mapping.update' & tiap ada participantAlt) */
function rememberMapping(lid, pn) {
  if (isLidJid(lid) && isPnJid(pn)) {
    cacheLidToPn.set(lid, pn);
    cachePnToLid.set(pn, lid);
  }
}

/**
 * Kumpulkan semua representasi identitas pengirim pesan yang bisa didapat
 * TANPA network call (langsung dari struktur pesan), lalu lengkapi dengan
 * lookup mapping bila perlu.
 *
 * @param {object} sock - socket baileys aktif
 * @param {object} m - objek pesan Baileys (message)
 * @returns {Promise<{jids: Set<string>, numbers: Set<string>}>}
 */
async function collectIdentities(sock, m) {
  const jids = new Set();
  const key = m?.key || {};

  const candidates = [
    key.participant,
    key.participantAlt,
    key.remoteJid,
    key.remoteJidAlt,
    m?.participant,
    m?.participantAlt
  ].filter(Boolean);

  for (const c of candidates) jids.add(c);

  // Lengkapi pasangan LID<->PN lewat signalRepository
  for (const j of [...jids]) {
    if (isLidJid(j)) {
      const pn = await resolvePN(sock, j);
      if (pn) { jids.add(pn); rememberMapping(j, pn); }
    } else if (isPnJid(j)) {
      const lid = await resolveLID(sock, j);
      if (lid) { jids.add(lid); rememberMapping(lid, j); }
    }
  }

  const numbers = new Set([...jids].map(rawId).filter(Boolean));
  return { jids, numbers };
}

/**
 * Cek apakah pengirim pesan `m` adalah salah satu nomor di `ownerNumbers`
 * (array string dari config/settings, format bebas).
 */
async function isOwner(sock, m, ownerNumbers = []) {
  const ownerSet = new Set(
    ownerNumbers.map(normalizeNumber).filter(Boolean)
  );
  // botpun otomatis dianggap owner (untuk self-command)
  const botNumber = normalizeNumber(rawId(sock?.user?.id));
  if (botNumber) ownerSet.add(botNumber);

  const { numbers } = await collectIdentities(sock, m);
  for (const n of numbers) {
    if (ownerSet.has(n)) return true;
  }
  return false;
}

/**
 * Cek apakah pengirim pesan `m` adalah admin di grup `groupJid`.
 * Menangani participant list yang berisi campuran LID & PN (Baileys 7:
 * setiap participant punya field `id` (lid) dan `pn` bila addressing mode LID).
 */
async function isGroupAdmin(sock, groupJid, m) {
  if (!isGroupJid(groupJid)) return false;
  let metadata;
  try {
    metadata = await sock.groupMetadata(groupJid);
  } catch (_) {
    return false;
  }

  const { jids, numbers } = await collectIdentities(sock, m);

  for (const p of metadata.participants || []) {
    const pIdentities = new Set(
      [p.id, p.jid, p.lid, p.pn].filter(Boolean)
    );
    const pNumbers = new Set([...pIdentities].map(rawId).filter(Boolean));

    const matchByJid = [...pIdentities].some((x) => jids.has(x));
    const matchByNumber = [...pNumbers].some((x) => numbers.has(x));

    if (matchByJid || matchByNumber) {
      return p.admin === 'admin' || p.admin === 'superadmin' || !!p.admin;
    }
  }
  return false;
}

/** Cek apakah bot sendiri adalah admin di grup (dibutuhkan sebelum aksi kick/promote/dll) */
async function isBotAdmin(sock, groupJid) {
  if (!isGroupJid(groupJid)) return false;
  let metadata;
  try {
    metadata = await sock.groupMetadata(groupJid);
  } catch (_) {
    return false;
  }
  const botNumber = rawId(sock?.user?.id);
  const botLid = rawId(sock?.user?.lid);
  for (const p of metadata.participants || []) {
    const pNumbers = new Set(
      [p.id, p.jid, p.lid, p.pn].filter(Boolean).map(rawId)
    );
    if (pNumbers.has(botNumber) || (botLid && pNumbers.has(botLid))) {
      return p.admin === 'admin' || p.admin === 'superadmin' || !!p.admin;
    }
  }
  return false;
}

/** Format angka jadi PN JID standar, dipakai saat mau kirim pesan manual berdasar nomor config */
function toPnJid(number) {
  const n = normalizeNumber(number);
  return n ? `${n}@s.whatsapp.net` : null;
}

module.exports = {
  onlyDigits,
  isLidJid,
  isPnJid,
  isGroupJid,
  rawId,
  normalizeNumber,
  resolvePN,
  resolveLID,
  rememberMapping,
  collectIdentities,
  isOwner,
  isGroupAdmin,
  isBotAdmin,
  toPnJid
};
