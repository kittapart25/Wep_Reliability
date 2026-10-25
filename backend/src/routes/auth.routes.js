const express = require('express');
const store = require('../store');
const { hashPassword, verifyPassword, createSession, publicUser, requireAuth } = require('../auth');

const router = express.Router();

// naive in-memory brute-force guard: 8 failed attempts / 10 min per employee id
const fails = new Map();
function tooMany(id) {
  const f = fails.get(id);
  return f && f.count >= 8 && Date.now() - f.first < 10 * 60 * 1000;
}
function recordFail(id) {
  const f = fails.get(id);
  if (!f || Date.now() - f.first > 10 * 60 * 1000) fails.set(id, { count: 1, first: Date.now() });
  else f.count++;
}

router.post('/login', (req, res) => {
  const { empId, password } = req.body || {};
  if (!/^\d{6}$/.test(String(empId || ''))) return res.status(400).json({ error: 'กรุณากรอกรหัสพนักงานเป็นตัวเลข 6 หลัก' });
  if (tooMany(empId)) return res.status(429).json({ error: 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่' });

  const emp = store.get('employees', empId);
  if (!emp) return res.status(401).json({ error: 'ไม่พบรหัสพนักงานนี้ในระบบ กรุณาติดต่อผู้ดูแลระบบ' });
  if (!verifyPassword(password, emp.passwordHash)) {
    recordFail(empId);
    return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
  }
  fails.delete(empId);
  res.json({ token: createSession(empId), user: publicUser(empId, emp) });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post('/logout', requireAuth, (req, res) => {
  store.sessions.delete(req.token);
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const emp = store.get('employees', req.user.empId);
  if (!verifyPassword(currentPassword, emp.passwordHash)) return res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  if (!newPassword || String(newPassword).length < 4) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร' });
  store.update('employees', req.user.empId, { passwordHash: hashPassword(newPassword) });
  res.json({ ok: true });
});

module.exports = router;
