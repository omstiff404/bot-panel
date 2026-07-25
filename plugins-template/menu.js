const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}h ${h}j ${min}m ${s}d`;
}

module.exports = {
  name: 'menu',
  command: ['menu', 'help'],
  category: 'main',
  description: 'Menampilkan semua fitur bot secara otomatis, terkelompok per kategori',
  owner: false,
  admin: false,
  group: false,
  async run(ctx) {
    const { sock, from, m, settings, isOwner, plugins } = ctx; // ctx.plugins = plugin milik user ini, sudah di-load dispatcher

    // ---- Kelompokkan OTOMATIS berdasar field category tiap plugin, semua command tampil ----
    const grouped = {};
    for (const p of plugins) {
      const cat = (p.category || 'lainnya').toUpperCase();
      if (!grouped[cat]) grouped[cat] = [];
      const cmds = Array.isArray(p.command) ? p.command : [p.command];
      grouped[cat].push({ cmds, desc: p.description || '-', owner: !!p.owner, admin: !!p.admin, limit: !!p.limit });
    }

    const now = moment().tz(settings.timezone || 'Asia/Jakarta');
    const totalCommands = plugins.reduce(
      (sum, p) => sum + (Array.isArray(p.command) ? p.command.length : 1), 0
    );

    let text = `╭───⧼ *${settings.botName}* ⧽───╮\n`;
    text += `│ 🕐 ${now.format('HH:mm:ss')} WIB\n`;
    text += `│ 📅 ${now.format('dddd, DD MMMM YYYY')}\n`;
    text += `│ ⏱️ Uptime: ${formatUptime(process.uptime())}\n`;
    text += `│ ⚙️ Prefix: ${settings.prefix}\n`;
    text += `│ 🧩 Total Fitur: ${totalCommands}\n`;
    text += `│ 📂 Total Kategori: ${Object.keys(grouped).length}\n`;
    text += `╰────────────────────╯\n\n`;

    for (const cat of Object.keys(grouped).sort()) {
      text += `┏━❮ *${cat}* ❯\n`;
      for (const item of grouped[cat]) {
        if (item.owner && !isOwner) continue; // sembunyikan menu owner dari non-owner
        const tag = item.owner ? ' 👑' : item.admin ? ' 🛡️' : item.limit ? ' 💎' : '';
        // tampilkan SEMUA alias command dalam satu baris, bukan cuma yang pertama
        for (const cmd of item.cmds) {
          text += `┃ ${settings.prefix}${cmd}${tag}\n`;
        }
      }
      text += `┗━━━━━━━━━━━━━━━\n\n`;
    }

    text += `_Ketik ${settings.prefix}menu kapan saja untuk melihat daftar ini lagi._`;
    if (settings.menuFooter) text += `\n${settings.menuFooter}`;

    // ---- Kirim gambar header menu kalau sudah di-upload lewat dashboard ----
    const imagePath = settings.menuImage
      ? path.join(global.WA_BOT.ROOT_DIR, 'web', 'public', settings.menuImage)
      : null;

    if (imagePath && fs.existsSync(imagePath)) {
      await sock.sendMessage(from, { image: fs.readFileSync(imagePath), caption: text }, { quoted: m });
    } else {
      await sock.sendMessage(from, { text }, { quoted: m });
    }

    // ---- Kirim audio menu kalau sudah di-upload lewat dashboard ----
    const audioPath = settings.menuAudio
      ? path.join(global.WA_BOT.ROOT_DIR, 'web', 'public', settings.menuAudio)
      : null;

    if (audioPath && fs.existsSync(audioPath)) {
      await sock.sendMessage(
        from,
        { audio: fs.readFileSync(audioPath), mimetype: 'audio/mp4', ptt: false },
        { quoted: m }
      );
    }
  }
};
