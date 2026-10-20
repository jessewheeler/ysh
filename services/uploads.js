const path = require('path');
const fs = require('fs');
const storage = require('./storage');

/**
 * Saves an uploaded file (a multer memoryStorage file) and returns its public URL: Backblaze B2
 * when it is configured, otherwise data/uploads, served at /uploads (local development).
 */
async function saveUpload(file, folder) {
  if (storage.isConfigured()) {
    return storage.uploadFile(file.buffer, file.originalname, folder);
  }
  const localName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`;
  // server.js mkdirs this at boot, but the write is what needs it: data/ is gitignored,
  // so anything that reaches here without booting the server (Jest, a CLI script) hit
  // ENOENT and reported it as an upload failure.
  const dir = path.join(__dirname, '..', 'data', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, localName), file.buffer);
  return `/uploads/${localName}`;
}

module.exports = { saveUpload };
