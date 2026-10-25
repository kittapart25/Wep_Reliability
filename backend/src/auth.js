const crypto = require('crypto');
const store = require('./store');
const { SESSION_TTL_MS } = require('./config');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === test.length && crypto.timingSafeEqual(expected, test);
}

function createSession(empId) {
  const token = crypto.randomBytes(32).toString('hex');
  store.sessions.set(token, { empId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function publicUser(empId, data) {
  return { empId, name: data.name, dept: data.dept, role: data.role };
}

// Reads "Authorization: Bearer <token>" or ?token= (needed for EventSource).
function requireAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const session = token && store.sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) store.sessions.delete(token);
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบใหม่' });
  }
  const emp = store.get('employees', session.empId);
  if (!emp) return res.status(401).json({ error: 'ไม่พบบัญชีผู้ใช้' });
  req.token = token;
  req.user = { ...publicUser(session.empId, emp) };
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'ต้องใช้สิทธิ์ Admin' });
  next();
}

module.exports = { hashPassword, verifyPassword, createSession, publicUser, requireAuth, requireAdmin };
