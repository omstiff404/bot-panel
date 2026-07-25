const db = global.WA_BOT.db;

module.exports = {
  name: 'limit',
  command: ['limit', 'mylimit', 'cekvip'],
  category: 'main',
  description: 'Cek sisa limit harian atau status VIP/premium kamu',
  owner: false,
  admin: false,
  group: false,
  limit: false, // command cek limit sendiri tidak boleh ikut makan limit
  async run(ctx) {
    const { reply, senderNumber, settings, userId } = ctx;
    if (!senderNumber) return reply('Tidak bisa mendeteksi nomor kamu.');

    if (db.isPremiumActive(userId, senderNumber)) {
      const info = db.getPremiumInfo(userId, senderNumber);
      const expireText = !info?.expiresAt
        ? 'Selamanya (lifetime)'
        : new Date(info.expiresAt).toLocaleString('id-ID', { timeZone: settings.timezone || 'Asia/Jakarta' });
      return reply(
        `👑 *Status: VIP/PREMIUM*\n` +
        `✨ Pemakaian command: *Unlimited*\n` +
        `⏳ Berlaku sampai: ${expireText}`
      );
    }

    const usage = db.getRemainingLimit(userId, senderNumber, settings.defaultLimit, settings.limitResetHours);
    const resetText = usage.resetAt
      ? new Date(usage.resetAt).toLocaleString('id-ID', { timeZone: settings.timezone || 'Asia/Jakarta' })
      : 'Belum digunakan hari ini';

    return reply(
      `👤 *Status: User Biasa*\n` +
      `📊 Sisa limit: *${usage.remaining}/${usage.limit}* hari ini\n` +
      `🔄 Reset pada: ${resetText}\n\n` +
      `👑 Upgrade ke VIP untuk pemakaian unlimited!\n` +
      `Hubungi owner: https://wa.me/${settings.ownerContact}`
    );
  }
};
