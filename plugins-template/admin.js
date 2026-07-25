const { isGroupJid } = global.WA_BOT.jidHelper;

/**
 * Satu file "admin" berisi beberapa command pengaturan grup.
 * Semua command butuh: pengirim = admin grup, dan bot = admin grup.
 */

async function getTargetJid(ctx) {
  // ambil target dari mention atau dari pesan yang di-reply
  const { m } = ctx;
  const ctxInfo = m.message?.extendedTextMessage?.contextInfo;
  const mentioned = ctxInfo?.mentionedJid?.[0];
  const quotedParticipant = ctxInfo?.participant;
  return mentioned || quotedParticipant || null;
}

module.exports = {
  name: 'admin',
  command: [
    'kick', 'add', 'promote', 'demote',
    'grouplink', 'revoke', 'close', 'open',
    'setname', 'setdesc', 'tagall', 'hidetag'
  ],
  category: 'admin group',
  description: 'Semua pengaturan group: kick/add/promote/demote/link/close/open/tagall dll',
  owner: false,
  admin: true,
  group: true,
  async run(ctx) {
    const { sock, from, args, command, reply, m } = ctx;
    if (!isGroupJid(from)) return;

    switch (command) {
      case 'kick': {
        const target = await getTargetJid(ctx);
        if (!target) return reply('Tag atau reply pesan orang yang mau dikeluarkan.');
        await sock.groupParticipantsUpdate(from, [target], 'remove');
        return reply('✅ Berhasil mengeluarkan anggota.');
      }
      case 'add': {
        const number = args[0]?.replace(/\D/g, '');
        if (!number) return reply('Format: .add 628xxxxxxxxxx');
        await sock.groupParticipantsUpdate(from, [`${number}@s.whatsapp.net`], 'add');
        return reply('✅ Berhasil menambahkan anggota.');
      }
      case 'promote': {
        const target = await getTargetJid(ctx);
        if (!target) return reply('Tag atau reply orang yang mau dijadikan admin.');
        await sock.groupParticipantsUpdate(from, [target], 'promote');
        return reply('✅ Berhasil menjadikan admin.');
      }
      case 'demote': {
        const target = await getTargetJid(ctx);
        if (!target) return reply('Tag atau reply admin yang mau diturunkan.');
        await sock.groupParticipantsUpdate(from, [target], 'demote');
        return reply('✅ Berhasil menurunkan admin.');
      }
      case 'grouplink': {
        const code = await sock.groupInviteCode(from);
        return reply(`🔗 https://chat.whatsapp.com/${code}`);
      }
      case 'revoke': {
        await sock.groupRevokeInvite(from);
        return reply('✅ Link grup berhasil direset.');
      }
      case 'close': {
        await sock.groupSettingUpdate(from, 'announcement');
        return reply('🔒 Grup dikunci, hanya admin yang bisa chat.');
      }
      case 'open': {
        await sock.groupSettingUpdate(from, 'not_announcement');
        return reply('🔓 Grup dibuka, semua anggota bisa chat.');
      }
      case 'setname': {
        const name = ctx.text.split(' ').slice(1).join(' ');
        if (!name) return reply('Format: .setname Nama Grup Baru');
        await sock.groupUpdateSubject(from, name);
        return reply('✅ Nama grup diubah.');
      }
      case 'setdesc': {
        const desc = ctx.text.split(' ').slice(1).join(' ');
        if (!desc) return reply('Format: .setdesc Deskripsi baru');
        await sock.groupUpdateDescription(from, desc);
        return reply('✅ Deskripsi grup diubah.');
      }
      case 'tagall': {
        const metadata = await sock.groupMetadata(from);
        const ids = metadata.participants.map((p) => p.id);
        const text = `📢 *Tag Semua Anggota*\n\n${ids.map((id) => `@${id.split('@')[0]}`).join(' ')}`;
        return sock.sendMessage(from, { text, mentions: ids }, { quoted: m });
      }
      case 'hidetag': {
        const metadata = await sock.groupMetadata(from);
        const ids = metadata.participants.map((p) => p.id);
        const text = ctx.text.split(' ').slice(1).join(' ') || '📢';
        return sock.sendMessage(from, { text, mentions: ids }, { quoted: m });
      }
      default:
        return;
    }
  }
};
