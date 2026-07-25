const { saveSettings, getSettings } = global.WA_BOT.config;
const db = global.WA_BOT.db;
const { normalizeNumber } = global.WA_BOT.jidHelper;

module.exports = {
  name: 'owner',
  command: [
    'setprefix', 'setbotname', 'public', 'self',
    'ban', 'unban', 'addowner', 'delowner',
    'listowner', 'restart', 'broadcast',
    'addprem', 'delprem', 'listprem', 'setlimit'
  ],
  category: 'owner bot',
  description: 'Semua pengaturan bot: prefix, mode publik/privat, ban user, owner list, limit & VIP, dll',
  owner: true,
  admin: false,
  group: false,
  async run(ctx) {
    const { args, command, reply, text, userId } = ctx;
    const settings = getSettings(userId);

    switch (command) {
      case 'setprefix': {
        const newPrefix = args[0];
        if (!newPrefix) return reply('Format: .setprefix !');
        saveSettings(userId, { prefix: newPrefix });
        return reply(`✅ Prefix diubah menjadi: ${newPrefix}`);
      }
      case 'setbotname': {
        const name = text.split(' ').slice(1).join(' ');
        if (!name) return reply('Format: .setbotname Nama Bot Baru');
        saveSettings(userId, { botName: name });
        return reply('✅ Nama bot diubah.');
      }
      case 'public': {
        saveSettings(userId, { publicMode: true });
        return reply('🌐 Bot sekarang dalam mode PUBLIK.');
      }
      case 'self': {
        saveSettings(userId, { publicMode: false });
        return reply('🔒 Bot sekarang dalam mode PRIVATE (hanya owner).');
      }
      case 'ban': {
        const number = normalizeNumber(args[0]);
        if (!number) return reply('Format: .ban 628xxxxxxxxxx');
        db.setBanned(userId, number, true);
        return reply(`✅ ${number} diblokir dari bot.`);
      }
      case 'unban': {
        const number = normalizeNumber(args[0]);
        if (!number) return reply('Format: .unban 628xxxxxxxxxx');
        db.setBanned(userId, number, false);
        return reply(`✅ ${number} dibuka blokirnya.`);
      }
      case 'addowner': {
        const number = normalizeNumber(args[0]);
        if (!number) return reply('Format: .addowner 628xxxxxxxxxx');
        const owners = new Set(settings.ownerNumbers);
        owners.add(number);
        saveSettings(userId, { ownerNumbers: [...owners] });
        return reply(`✅ ${number} ditambahkan sebagai owner.`);
      }
      case 'delowner': {
        const number = normalizeNumber(args[0]);
        if (!number) return reply('Format: .delowner 628xxxxxxxxxx');
        const owners = settings.ownerNumbers.filter((n) => n !== number);
        saveSettings(userId, { ownerNumbers: owners });
        return reply(`✅ ${number} dihapus dari daftar owner.`);
      }
      case 'listowner': {
        if (!settings.ownerNumbers.length) return reply('Belum ada owner terdaftar.');
        return reply(`👑 Daftar Owner:\n${settings.ownerNumbers.map((n) => `- ${n}`).join('\n')}`);
      }
      case 'restart': {
        await reply('♻️ Bot kamu akan restart...');
        process.exit(0); // biarkan process manager (pm2/systemd) yang restart
      }
      case 'broadcast': {
        const message = text.split(' ').slice(1).join(' ');
        if (!message) return reply('Format: .broadcast Pesan yang ingin disebar');
        const users = db.getAllUsers(userId);
        let sent = 0;
        for (const number of Object.keys(users)) {
          try {
            await ctx.sock.sendMessage(`${number}@s.whatsapp.net`, { text: `📢 ${message}` });
            sent++;
          } catch (_) {}
        }
        return reply(`✅ Broadcast terkirim ke ${sent} user.`);
      }
      case 'addprem': {
        const number = normalizeNumber(args[0]);
        const days = parseInt(args[1], 10) || 0; // 0 = lifetime
        if (!number) return reply('Format: .addprem 628xxxxxxxxxx [jumlahHari]\nContoh: .addprem 628123456789 30\nKosongkan jumlahHari untuk lifetime.');
        db.setPremium(userId, number, days);
        const durText = days > 0 ? `${days} hari` : 'lifetime (selamanya)';
        return reply(`✅ ${number} sekarang VIP/Premium (unlimited)\n⏳ Durasi: ${durText}`);
      }
      case 'delprem': {
        const number = normalizeNumber(args[0]);
        if (!number) return reply('Format: .delprem 628xxxxxxxxxx');
        db.removePremium(userId, number);
        return reply(`✅ Status VIP/Premium ${number} dicabut.`);
      }
      case 'listprem': {
        const premiumUsers = db.getAllPremium(userId);
        const entries = Object.entries(premiumUsers);
        if (!entries.length) return reply('Belum ada user VIP/Premium.');
        const lines = entries.map(([number, p]) => {
          const exp = !p.expiresAt ? 'lifetime' : new Date(p.expiresAt).toLocaleDateString('id-ID');
          return `- ${number} (sampai: ${exp})`;
        });
        return reply(`👑 *Daftar VIP/Premium:*\n${lines.join('\n')}`);
      }
      case 'setlimit': {
        const amount = parseInt(args[0], 10);
        if (!amount || amount < 1) return reply('Format: .setlimit 99');
        saveSettings(userId, { defaultLimit: amount });
        return reply(`✅ Limit harian default diubah menjadi ${amount}x/hari.`);
      }
      default:
        return;
    }
  }
};
