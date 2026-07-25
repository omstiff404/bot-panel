const groupSettings = global.WA_BOT.groupSettings;

module.exports = {
  name: 'group-welcome-leave',
  command: ['setwelcome', 'setleave'],
  category: 'admin group',
  description: 'Aktif/nonaktifkan pesan welcome/leave di grup ini — satu-satunya kontrol, khusus admin grup',
  owner: false,
  admin: true,
  group: true,
  async run(ctx) {
    const { command, args, from, reply, userId } = ctx;
    const state = (args[0] || '').toLowerCase();

    if (!['on', 'off'].includes(state)) {
      return reply(`Format: .${command} on/off\nContoh: .${command} on`);
    }

    const key = command === 'setwelcome' ? 'welcome' : 'leave';
    const label = key === 'welcome' ? 'Welcome' : 'Leave';
    groupSettings.setGroupSetting(userId, from, key, state === 'on');

    return reply(`✅ Pesan *${label}* di grup ini sekarang: *${state.toUpperCase()}*`);
  }
};
