const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const pino = require('pino');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const silentLogger = pino({ level: 'silent' });

/**
 * Ambil pesan media: dari yang di-reply (quoted) kalau ada, atau dari pesan langsung.
 */
function resolveMediaTarget(m) {
  const contextInfo =
    m.message?.extendedTextMessage?.contextInfo ||
    m.message?.imageMessage?.contextInfo ||
    m.message?.videoMessage?.contextInfo;

  if (contextInfo?.quotedMessage) {
    return {
      key: {
        remoteJid: m.key.remoteJid,
        id: contextInfo.stanzaId,
        participant: contextInfo.participant,
        fromMe: false
      },
      message: contextInfo.quotedMessage
    };
  }
  return m;
}

function hasMedia(target) {
  return !!(target.message?.imageMessage || target.message?.videoMessage);
}

function uint32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

/**
 * Sisipkan metadata nama pack & author ke file webp (format EXIF khusus yang dibaca WhatsApp
 * untuk menampilkan nama pack stiker). Ditulis manual dengan buffer, tanpa dependency tambahan.
 */
function addStickerExif(webpBuffer, packname, author) {
  const json = {
    'sticker-pack-id': crypto.randomBytes(16).toString('hex'),
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    emojis: ['🤖']
  };
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41,
    0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ]);
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf-8');
  const exif = Buffer.concat([exifAttr, jsonBuffer]);
  exif.writeUIntLE(jsonBuffer.length, 14, 4);

  let chunk = Buffer.concat([Buffer.from('EXIF'), uint32le(exif.length), exif]);
  if (chunk.length % 2 !== 0) chunk = Buffer.concat([chunk, Buffer.from([0x00])]); // RIFF chunk harus genap

  const newRiffSize = webpBuffer.readUInt32LE(4) + chunk.length;
  const out = Buffer.concat([webpBuffer, chunk]);
  out.writeUInt32LE(newRiffSize, 4);
  return out;
}

/** Gambar -> webp statis, pakai sharp */
async function imageToWebpSticker(buffer) {
  return sharp(buffer)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 75 })
    .toBuffer();
}

/** Video -> webp animasi, pakai fluent-ffmpeg (butuh ffmpeg terinstall di sistem) */
function videoToWebpSticker(buffer) {
  return new Promise((resolve, reject) => {
    const tmpDir = os.tmpdir();
    const uid = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const inputPath = path.join(tmpDir, `stk-in-${uid}.mp4`);
    const outputPath = path.join(tmpDir, `stk-out-${uid}.webp`);

    fs.writeFileSync(inputPath, buffer);

    const cleanup = () => {
      try { fs.unlinkSync(inputPath); } catch (_) {}
      try { fs.unlinkSync(outputPath); } catch (_) {}
    };

    ffmpeg(inputPath)
      .noAudio()
      .duration(10) // batasi durasi maksimal 10 detik
      .outputOptions([
        '-vcodec', 'libwebp',
        '-vf',
        "scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=white@0.0",
        '-loop', '0',
        '-preset', 'default',
        '-an',
        '-vsync', '0'
      ])
      .toFormat('webp')
      .on('error', (err) => { cleanup(); reject(err); })
      .on('end', () => {
        try {
          const out = fs.readFileSync(outputPath);
          cleanup();
          resolve(out);
        } catch (err) {
          cleanup();
          reject(err);
        }
      })
      .save(outputPath);
  });
}

module.exports = {
  name: 'sticker',
  command: ['sticker', 's', 'stiker'],
  category: 'tools',
  description: 'Ubah gambar/video (max ~10 detik) jadi stiker WhatsApp',
  owner: false,
  admin: false,
  group: false,
  limit: true, // konsumsi limit harian, kecuali user VIP/premium
  async run(ctx) {
    const { sock, m, from, reply, settings } = ctx;

    const target = resolveMediaTarget(m);
    if (!hasMedia(target)) {
      return reply('Kirim gambar/video lalu kasih caption *.sticker*, atau reply gambar/video dengan *.sticker*.');
    }

    const videoSeconds = target.message?.videoMessage?.seconds;
    if (videoSeconds && videoSeconds > 30) {
      return reply('❌ Video terlalu panjang (maksimal ~30 detik untuk diproses jadi stiker).');
    }

    try {
      const buffer = await downloadMediaMessage(
        target,
        'buffer',
        {},
        { logger: silentLogger, reuploadRequest: sock.updateMediaMessage }
      );
      const isVideo = !!target.message?.videoMessage;

      let webpBuffer = isVideo ? await videoToWebpSticker(buffer) : await imageToWebpSticker(buffer);
      webpBuffer = addStickerExif(
        webpBuffer,
        settings.stickerPackname || 'WA Bot 2026',
        settings.stickerAuthor || 'Dashboard'
      );

      await sock.sendMessage(from, { sticker: webpBuffer }, { quoted: m });
    } catch (err) {
      console.error('[STICKER ERROR]', err);
      return reply('❌ Gagal membuat stiker. Pastikan file gambar/video valid dan tidak terlalu besar.');
    }
  }
};
