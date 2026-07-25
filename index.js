const chalk = require('chalk');
const crypto = require('crypto');

const MASTER_USER_ID = 'master';

// Daftarkan lib inti secara global supaya SEMUA plugin (termasuk yang di-copy
// ke folder tiap user di data/<userId>/plugins/) bisa akses tanpa pusing soal
// path relatif (karena lokasi file plugin tiap user beda-beda kedalamannya).
global.WA_BOT = {
  ROOT_DIR: __dirname,
  MASTER_USER_ID,
  db: require('./lib/database'),
  jidHelper: require('./lib/jidHelper'),
  groupSettings: require('./lib/groupSettings'),
  groupCache: require('./lib/groupCache'),
  config: require('./config'),
  accountStore: require('./lib/accountStore'),
  otpStore: require('./lib/otpStore')
};

const { startWebServer } = require('./web/server');
const botManager = require('./lib/botManager');
const pluginLoader = require('./lib/pluginLoader');

(async () => {
  console.log(chalk.cyan('════════════════════════════════════'));
  console.log(chalk.cyan('   WA BOT DASHBOARD 2026 — starting  '));
  console.log(chalk.cyan('════════════════════════════════════'));

  // ---- Akun "master" dibuat otomatis kalau belum ada. Bot ini yang nanti     ----
  // ---- mengirim kode verifikasi WhatsApp ke orang yang mendaftar (register). ----
  const { accountStore } = global.WA_BOT;
  if (!accountStore.getAccount(MASTER_USER_ID)) {
    const randomPassword = crypto.randomBytes(6).toString('hex');
    const acc = accountStore.register('master', randomPassword, '', 'Bot Verifikasi');
    pluginLoader.seedDefaultPlugins(acc.id);
    console.log(chalk.yellow('════════════════════════════════════════════════════'));
    console.log(chalk.yellow('  AKUN MASTER (bot pengirim kode verifikasi) DIBUAT  '));
    console.log(chalk.yellow(`  Username : master`));
    console.log(chalk.yellow(`  Password : ${randomPassword}`));
    console.log(chalk.yellow('  -> Login ke /login.html pakai akun ini, lalu pasang'));
    console.log(chalk.yellow('     pairing code di sana supaya nomor WA-nya bisa'));
    console.log(chalk.yellow('     mengirim kode OTP ke orang yang daftar.'));
    console.log(chalk.yellow('  Catat password ini sekarang, tidak ditampilkan lagi.'));
    console.log(chalk.yellow('════════════════════════════════════════════════════'));
  }

  const { io } = await startWebServer();

  // Kalau proses mau berhenti (restart/deploy), paksa tulis dulu data yang masih
  // "nunggu" di memori (message count, group cache) supaya tidak hilang.
  const shutdown = () => {
    console.log(chalk.yellow('\nMenyimpan data yang masih tertunda sebelum keluar...'));
    global.WA_BOT.db.flushAllPending();
    global.WA_BOT.groupCache.flushAllPending();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Auto-resume bot untuk semua akun yang sesi WhatsApp-nya sudah pernah terhubung
  const accounts = accountStore.getAllAccounts();
  for (const userId of Object.keys(accounts)) {
    if (botManager.hasExistingSession(userId)) {
      botManager.startBotForUser(userId, io).catch((err) =>
        console.error(`[BOOT] Gagal resume bot ${userId}:`, err.message)
      );
    }
  }
})();
