const fs = require('fs-extra');
const path = require('path');

const TEMPLATE_DIR = path.join(__dirname, '..', 'plugins-template');

// loadPlugins() dipanggil di SETIAP command yang masuk (hot-path). Sebelumnya
// tiap panggilan itu delete require.cache + require() ULANG semua file plugin
// dari disk (baca + compile + jalankan file JS-nya lagi) — padahal isinya
// hampir selalu SAMA dengan panggilan sebelumnya. Itu nambah latency ke setiap
// balasan command, padahal plugin cuma berubah kalau user edit lewat dashboard.
//
// Fix: cache hasil load per userId, cuma re-require kalau "signature" folder
// plugin-nya berubah (nama file + waktu modifikasi terakhir tiap file).
// Ngecek signature ini murah (readdirSync + statSync), jauh lebih murah
// daripada require() ulang semua file.
const pluginCache = new Map(); // userId -> { signature, plugins }

function pluginDir(userId) {
  return path.join(__dirname, '..', 'data', userId, 'plugins');
}

/** Dipanggil sekali saat user baru register: copy semua plugin bawaan ke folder mereka sendiri */
function seedDefaultPlugins(userId) {
  const dir = pluginDir(userId);
  fs.ensureDirSync(dir);
  const files = fs.readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    fs.copyFileSync(path.join(TEMPLATE_DIR, file), path.join(dir, file));
  }
}

function computeSignature(dir, files) {
  // gabungan nama file + mtime tiap file — kalau ada yang ditambah/dihapus/diedit, signature-nya beda
  return files
    .map((f) => {
      try {
        const stat = fs.statSync(path.join(dir, f));
        return `${f}:${stat.mtimeMs}`;
      } catch (_) {
        return f;
      }
    })
    .join('|');
}

/**
 * Setiap file plugin harus export object:
 * {
 *   name, command: [..], category, description,
 *   owner, admin, group, limit,
 *   run: async (ctx) => { ... }
 * }
 */
function loadPlugins(userId) {
  const dir = pluginDir(userId);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  const signature = computeSignature(dir, files);

  const cached = pluginCache.get(userId);
  if (cached && cached.signature === signature) {
    return cached.plugins; // tidak ada perubahan sejak load terakhir, pakai cache
  }

  // ada perubahan (atau load pertama kali) — baru require() ulang
  const plugins = [];
  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      delete require.cache[require.resolve(fullPath)];
      const plugin = require(fullPath);
      if (plugin && plugin.command) {
        plugin.__file = file;
        plugins.push(plugin);
      }
    } catch (err) {
      console.error(`[PLUGIN ERROR] Gagal load ${file} milik ${userId}:`, err.message);
    }
  }

  pluginCache.set(userId, { signature, plugins });
  return plugins;
}

/** Dipanggil setelah dashboard menyimpan/menghapus plugin, supaya command berikutnya langsung fresh */
function invalidatePluginCache(userId) {
  pluginCache.delete(userId);
}

function findPlugin(plugins, commandText) {
  return plugins.find((p) => {
    const cmds = Array.isArray(p.command) ? p.command : [p.command];
    return cmds.includes(commandText);
  });
}

function totalFeatures(userId) {
  return loadPlugins(userId).reduce((sum, p) => {
    const cmds = Array.isArray(p.command) ? p.command : [p.command];
    return sum + cmds.length;
  }, 0);
}

function listPluginFiles(userId) {
  const dir = pluginDir(userId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
}

module.exports = {
  loadPlugins,
  findPlugin,
  totalFeatures,
  listPluginFiles,
  pluginDir,
  seedDefaultPlugins,
  invalidatePluginCache,
  TEMPLATE_DIR
};
