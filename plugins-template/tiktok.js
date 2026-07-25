/**
 * Downloader TikTok tanpa watermark, pakai API publik tikwm.com.
 * Node.js 24 sudah punya global fetch bawaan, jadi tidak perlu dependency tambahan.
 */

module.exports = {
  name: 'tiktok',
  command: ['tiktok', 'tt', 'ttdl'],
  category: 'downloader',
  description: 'Download video TikTok tanpa watermark',
  owner: false,
  admin: false,
  group: false,
  limit: true, // konsumsi limit harian, kecuali user VIP/premium
  async run(ctx) {
    const { args, reply, sock, from, m } = ctx;
    const url = args[0];

    if (!url || !/tiktok\.com/i.test(url)) {
      return reply('Format: .tiktok <link_tiktok>\nContoh: .tiktok https://vt.tiktok.com/xxxxx');
    }

    try {
      const apiRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
      const json = await apiRes.json();

      if (json.code !== 0 || !json.data?.play) {
        return reply('❌ Gagal mengambil video. Pastikan link TikTok valid dan videonya publik.');
      }

      const data = json.data;
      const videoUrl = data.play.startsWith('http') ? data.play : `https://www.tikwm.com${data.play}`;
      const caption =
        `🎵 *${data.title || 'TikTok Video'}*\n` +
        `👤 ${data.author?.nickname || '-'}\n` +
        `❤️ ${data.digg_count || 0}  💬 ${data.comment_count || 0}  🔁 ${data.share_count || 0}`;

      await sock.sendMessage(from, { video: { url: videoUrl }, caption }, { quoted: m });
    } catch (err) {
      console.error('[TIKTOK ERROR]', err);
      return reply('❌ Terjadi kesalahan saat mengambil video TikTok. Coba lagi nanti.');
    }
  }
};
