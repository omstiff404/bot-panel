const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  isJidBroadcast
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

const { getSettings } = require('../config');
const { loadPlugins, findPlugin } = require('./pluginLoader');
const jidHelper = require('./jidHelper');
const db = require('./database');
const groupSettings = require('./groupSettings');
const groupCache = require('./groupCache');

const logger = pino({ level: 'silent' });

// Semua bot aktif, key = userId. Value: { sock, state }
const bots = new Map();

function sessionDir(userId) {
  return path.join(__dirname, '..', 'session', userId);
}

function hasExistingSession(userId) {
  const credsPath = path.join(sessionDir(userId), 'creds.json');
  if (!fs.existsSync(credsPath)) return false;
  try {
    const creds = fs.readJsonSync(credsPath);
    return !!creds.registered;
  } catch (_) {
    return false;
  }
}

function getState(userId) {
  return bots.get(userId)?.state || {
    status: 'disconnected',
    pairingCode: null,
    connectedAt: null,
    profilePicUrl: null,
    pushName: null,
    number: null
  };
}

function getSock(userId) {
  return bots.get(userId)?.sock || null;
}

function isRunning(userId) {
  return bots.has(userId);
}

async function startBotForUser(userId, io) {
  if (bots.has(userId)) return bots.get(userId).sock; // sudah jalan, jangan duplikat

  const settings = getSettings(userId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir(userId));
  const { version } = await fetchLatestBaileysVersion();

  const botState = {
    status: 'connecting',
    pairingCode: null,
    connectedAt: null,
    profilePicUrl: null,
    pushName: null,
    number: null
  };
  bots.set(userId, { sock: null, state: botState });
  io?.to(userId).emit('bot:status', botState);

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false, // wajib pairing code, bukan QR
    browser: settings.browser, // ["Ubuntu", "Chrome", "20.0.04"]
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
    generateHighQualityLinkPreview: true
  });

  bots.set(userId, { sock, state: botState });

  if (settings.antiCall) {
    sock.ev.on('call', async (calls) => {
      for (const c of calls) {
        try { await sock.rejectCall(c.id, c.from); } catch (_) {}
      }
    });
  }

  // ---- Pairing code flow (dipicu otomatis kalau pairingNumber sudah diisi & belum registered) ----
  if (settings.usePairingCode && !sock.authState.creds.registered) {
    const targetNumber = jidHelper.normalizeNumber(settings.pairingNumber);
    if (targetNumber) {
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const code = await sock.requestPairingCode(targetNumber);
        botState.status = 'waiting_pairing';
        botState.pairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
        console.log(chalk.cyan(`[${userId}] PAIRING CODE: ${botState.pairingCode}`));
        io?.to(userId).emit('bot:pairingCode', botState.pairingCode);
        io?.to(userId).emit('bot:status', botState);
      } catch (err) {
        console.error(`[${userId}] Gagal request pairing code:`, err.message);
      }
    }
  }

  // ---- Auto-deteksi grup: setiap kali bot ada di grup (baru join / sync awal / metadata berubah),
  // ---- simpan info grupnya (nama + daftar member) ke cache lokal. Ini yang dipakai sebagai
  // ---- cadangan kalau nanti live-fetch metadata gagal pas welcome/leave (penyebab utama "gak respon").
  sock.ev.on('groups.upsert', (groups) => {
    for (const g of groups || []) {
      try { groupCache.saveGroup(userId, g.id, g); } catch (_) {}
    }
  });
  sock.ev.on('groups.update', async (updates) => {
    for (const u of updates || []) {
      if (!u?.id) continue;
      try {
        const full = await sock.groupMetadata(u.id);
        groupCache.saveGroup(userId, u.id, full);
      } catch (_) {}
    }
  });

  // ---- Welcome / Goodbye grup — satu-satunya kontrol: admin grup lewat .setwelcome / .setleave ----
  sock.ev.on('group-participants.update', async (update) => {
    const { id: groupJid, participants, action } = update;
    if (!participants?.length) return;
    if (action !== 'add' && action !== 'remove') return;

    const gs = groupSettings.getGroupSettings(userId, groupJid);
    if (action === 'add' && !gs.welcome) return;
    if (action === 'remove' && !gs.leave) return;

    // Ambil nama grup: coba live-fetch dulu, kalau GAGAL (rate limit, bot baru dikeluarkan, dll)
    // FALLBACK ke cache lokal, JANGAN batalkan pengiriman pesan cuma gara-gara ini gagal —
    // itu penyebab utama welcome/leave dulu "gak ada respon".
    let groupName = groupCache.getGroup(userId, groupJid)?.subject || 'grup ini';
    try {
      const metadata = await sock.groupMetadata(groupJid);
      groupName = metadata.subject;
      groupCache.saveGroup(userId, groupJid, metadata);
    } catch (err) {
      console.error(`[${userId}] [WELCOME/GOODBYE] fetch metadata gagal, pakai cache/fallback:`, err.message);
    }

    // Update cache partisipan langsung (incremental), supaya makin akurat tanpa perlu fetch ulang
    for (const participant of participants) {
      if (action === 'add') groupCache.addParticipant(userId, groupJid, participant);
      if (action === 'remove') groupCache.removeParticipant(userId, groupJid, participant);
    }

    // Kirim SATU PER SATU dengan try/catch masing-masing, supaya satu partisipan gagal
    // (mis. foto profilnya error) tidak menggagalkan partisipan lain dalam batch yang sama.
    for (const participant of participants) {
      try {
        const mentionTag = `@${jidHelper.rawId(participant)}`;
        const caption = action === 'add'
          ? `👋 Selamat datang ${mentionTag} di grup *${groupName}*!\nSemoga betah ya 🙌`
          : `👋 ${mentionTag} telah keluar dari grup *${groupName}*. Sampai jumpa!`;

        let profileUrl = null;
        try { profileUrl = await sock.profilePictureUrl(participant, 'image'); } catch (_) {}

        if (profileUrl) {
          await sock.sendMessage(groupJid, { image: { url: profileUrl }, caption, mentions: [participant] });
        } else {
          await sock.sendMessage(groupJid, { text: caption, mentions: [participant] });
        }
      } catch (err) {
        console.error(`[${userId}] [WELCOME/GOODBYE ERROR] gagal kirim untuk ${participant}:`, err.message);
      }
    }
  });

  sock.ev.on('lid-mapping.update', (updates) => {
    for (const u of updates || []) {
      if (u?.lid && u?.pn) jidHelper.rememberMapping(u.lid, u.pn);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      botState.status = 'connected';
      botState.connectedAt = Date.now();
      botState.pairingCode = null;
      botState.number = jidHelper.rawId(sock.user?.id);
      botState.pushName = sock.user?.name || settings.botName;

      // owner otomatis = nomor pemilik akun sendiri, kalau belum ada owner sama sekali
      const currentSettings = getSettings(userId);
      if (!currentSettings.ownerNumbers?.length && botState.number) {
        const { saveSettings } = require('../config');
        saveSettings(userId, { ownerNumbers: [botState.number] });
      }

      try {
        botState.profilePicUrl = await sock.profilePictureUrl(sock.user.id, 'image');
      } catch (_) {
        botState.profilePicUrl = null;
      }

      console.log(chalk.green(`✔ [${userId}] Bot tersambung sebagai ${botState.pushName} (${botState.number})`));
      io?.to(userId).emit('bot:status', botState);

      if (settings.markOnlineOnConnect) {
        try { await sock.sendPresenceUpdate('available'); } catch (_) {}
      }
      if (settings.autoBio) {
        try { await sock.updateProfileStatus(settings.autoBio); } catch (_) {}
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      botState.status = 'disconnected';
      io?.to(userId).emit('bot:status', botState);
      console.log(chalk.red(`✖ [${userId}] Koneksi terputus. Reconnect: ${shouldReconnect}`));
      bots.delete(userId);
      if (shouldReconnect) {
        setTimeout(() => startBotForUser(userId, io), 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const m = messages[0];
    if (!m?.message || m.key.fromMe) return;

    try {
      await handleMessage(userId, sock, m);
    } catch (err) {
      console.error(`[${userId}] [HANDLER ERROR]`, err);
    }
  });

  return sock;
}

function extractText(m) {
  const msg = m.message;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    ''
  ).trim();
}

async function handleMessage(userId, sock, m) {
  const settings = getSettings(userId);
  const from = m.key.remoteJid;
  const isGroup = jidHelper.isGroupJid(from);
  const text = extractText(m);

  const { numbers } = await jidHelper.collectIdentities(sock, m);
  const senderNumber = [...numbers][0];

  if (senderNumber) db.incrementMessageCount(userId, senderNumber);

  // ---- Auto-deteksi & simpan cache grup dari aktivitas biasa (bukan cuma pas ada yg keluar/masuk) ----
  // Ini yang bikin welcome/leave selalu punya data cadangan siap pakai kalau live-fetch gagal.
  if (isGroup && groupCache.isStale(userId, from)) {
    sock.groupMetadata(from)
      .then((meta) => groupCache.saveGroup(userId, from, meta))
      .catch(() => {});
  }

  if (settings.antiSpam && senderNumber && db.isBanned(userId, senderNumber)) return;

  // ---- Anti-link (grup, non-admin) ----
  if (isGroup && settings.antiLink && /(https?:\/\/|chat\.whatsapp\.com\/)/i.test(text)) {
    const isAdminUser = await jidHelper.isGroupAdmin(sock, from, m);
    if (!isAdminUser) {
      try {
        await sock.sendMessage(from, { delete: m.key });
        await sock.sendMessage(from, { text: '🚫 Link tidak diizinkan di grup ini.' });
      } catch (_) {}
      return;
    }
  }

  if (!text.startsWith(settings.prefix)) return;

  const isOwnerPreCheck = await jidHelper.isOwner(sock, m, settings.ownerNumbers);
  if (settings.maintenanceMode && !isOwnerPreCheck) return;
  if (settings.restrictToGroups && !isGroup) return;
  if (settings.restrictToPrivate && isGroup) return;

  if (settings.responseDelayMs > 0) {
    await new Promise((r) => setTimeout(r, settings.responseDelayMs));
  }

  const [cmdRaw, ...args] = text.slice(settings.prefix.length).trim().split(/\s+/);
  const command = (cmdRaw || '').toLowerCase();
  if (!command) return;

  const plugins = loadPlugins(userId);
  const plugin = findPlugin(plugins, command);
  if (!plugin) return;

  const isOwnerUser = isOwnerPreCheck;
  const isAdminUser = isGroup ? await jidHelper.isGroupAdmin(sock, from, m) : false;
  const isBotAdminGroup = isGroup ? await jidHelper.isBotAdmin(sock, from) : false;

  if (!settings.publicMode && !isOwnerUser) return;
  if (plugin.group && !isGroup) {
    return sock.sendMessage(from, { text: '❌ Perintah ini hanya berlaku di dalam grup.' }, { quoted: m });
  }
  if (plugin.owner && !isOwnerUser) {
    return sock.sendMessage(from, { text: '❌ Perintah ini khusus owner bot.' }, { quoted: m });
  }
  if (plugin.admin && !isAdminUser) {
    return sock.sendMessage(from, { text: '❌ Perintah ini khusus admin grup.' }, { quoted: m });
  }
  if (plugin.admin && isGroup && !isBotAdminGroup) {
    return sock.sendMessage(from, { text: '❌ Jadikan bot admin dulu untuk memakai perintah ini.' }, { quoted: m });
  }

  if (plugin.limit && senderNumber && !isOwnerUser) {
    const isPremiumUser = db.isPremiumActive(userId, senderNumber);
    if (!isPremiumUser) {
      const usage = db.checkAndConsumeLimit(userId, senderNumber, settings.defaultLimit, settings.limitResetHours);
      if (!usage.allowed) {
        return sock.sendMessage(
          from,
          {
            text:
              `⛔ Limit harian kamu sudah habis (${usage.limit}x/hari).\n` +
              `👑 Upgrade ke VIP/Premium untuk pemakaian *unlimited*.\n\n` +
              `Hubungi owner: https://wa.me/${settings.ownerContact}`
          },
          { quoted: m }
        );
      }
    }
  }

  const ctx = {
    sock,
    m,
    from,
    isGroup,
    args,
    text,
    command,
    settings,
    userId,
    isOwner: isOwnerUser,
    isAdmin: isAdminUser,
    isBotAdmin: isBotAdminGroup,
    senderNumber,
    plugins,
    reply: (content) =>
      sock.sendMessage(from, typeof content === 'string' ? { text: content } : content, { quoted: m })
  };

  try {
    await plugin.run(ctx);
  } catch (err) {
    console.error(`[${userId}] [PLUGIN ERROR] ${command}:`, err);
    try {
      await sock.sendMessage(
        from,
        {
          text:
            `⚠️ Terjadi kesalahan saat menjalankan perintah *${command}*.\n` +
            `Silakan coba lagi, atau hubungi owner jika terus terjadi:\n` +
            `https://wa.me/${settings.ownerContact}`
        },
        { quoted: m }
      );
    } catch (_) {}
  }
}

/** Logout dari WhatsApp + hapus folder sesi, supaya bisa pairing ulang dari nol */
async function logoutAndDeleteSession(userId) {
  const entry = bots.get(userId);
  if (entry?.sock) {
    try { await entry.sock.logout(); } catch (_) {}
  }
  bots.delete(userId);
  try { fs.removeSync(sessionDir(userId)); } catch (_) {}
}

/** Matikan bot (kalau lagi jalan) tanpa harus logout WA — dipakai sebelum hapus akun sepenuhnya */
function stopBotForUser(userId) {
  const entry = bots.get(userId);
  if (entry?.sock) {
    try { entry.sock.end(new Error('Account deleted')); } catch (_) {}
  }
  bots.delete(userId);
}

module.exports = {
  startBotForUser,
  getState,
  getSock,
  isRunning,
  hasExistingSession,
  logoutAndDeleteSession,
  stopBotForUser,
  sessionDir
};
