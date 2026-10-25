// POST /api/upload?filename=...   (raw file body, authenticated users)
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireAuth } = require('../auth');
const { UPLOAD_DIR, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT } = require('../config');

const router = express.Router();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

router.post(
  '/upload',
  requireAuth,
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  (req, res) => {
    const ext = path.extname(String(req.query.filename || '')).slice(1).toLowerCase();
    if (!ALLOWED_UPLOAD_EXT.includes(ext)) {
      return res.status(400).json({ error: `รองรับเฉพาะไฟล์ ${ALLOWED_UPLOAD_EXT.join(', ')}` });
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'ไม่พบไฟล์' });
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.${ext}`), req.body);
    res.status(201).json({ id, url: `/uploads/${id}.${ext}`, sizeBytes: req.body.length });
  }
);

module.exports = router;
