const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  DATA_FILE: process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json'),
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
  FRONTEND_DIR: process.env.FRONTEND_DIR || path.join(__dirname, '..', '..', 'frontend'),
  MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
  SESSION_TTL_MS: 12 * 60 * 60 * 1000, // 12 hours
  ALLOWED_UPLOAD_EXT: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip', '7z', 'rar'],
};
