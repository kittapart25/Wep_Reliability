// Generic document API (path style: collection/doc/subcollection/doc ...)
//   GET    /api/data/<collection>          -> { docs: [{id,data}] }
//   POST   /api/data/<collection>          -> { id }            (add)
//   GET    /api/data/<collection>/<id>     -> { id, exists, data }
//   PUT    /api/data/<collection>/<id>     -> set (replace)
//   PATCH  /api/data/<collection>/<id>     -> update (merge)
//   DELETE /api/data/<collection>/<id>
//   GET    /api/stream/<collection>        -> Server-Sent Events, full snapshot on every change
const express = require('express');
const store = require('../store');
const { hashPassword, requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

function parsePath(raw) {
  const segs = String(raw || '').split('/').filter(Boolean);
  if (!segs.length || segs.length > 6 || !segs.every((s) => /^[A-Za-z0-9_-]+$/.test(s))) return null;
  return segs;
}
const isCollection = (segs) => segs.length % 2 === 1;
const collPathOf = (segs) => (isCollection(segs) ? segs : segs.slice(0, -1)).join('/');

// strip secrets before sending to the browser
function outgoing(root, data) {
  if (root !== 'employees') return data;
  const { passwordHash, ...safe } = data;
  return safe;
}
// turn a plaintext "password" field into a hash; never trust client-sent hashes
function incoming(root, data) {
  const d = { ...(data || {}) };
  if (root === 'employees') {
    delete d.passwordHash;
    if (d.password !== undefined) {
      d.passwordHash = hashPassword(d.password);
      delete d.password;
    }
  }
  return d;
}

// Who may write what: admins everything; requesters only create requests and edit their own.
function canWrite(user, segs, method, existing) {
  if (user.role === 'admin') return true;
  if (segs[0] !== 'requests' || segs.length > 2) return false;
  if (method === 'POST') return true;
  return !!existing && existing.requesterEmpId === user.empId && method !== 'PUT';
}
const deny = (res) => res.status(403).json({ error: 'ไม่มีสิทธิ์ดำเนินการนี้' });

router.get('/stream/*', (req, res) => {
  const segs = parsePath(req.params[0]);
  if (!segs || !isCollection(segs)) return res.status(400).json({ error: 'bad path' });
  const p = segs.join('/');
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = () => {
    const docs = store.list(p).map((d) => ({ id: d.id, data: outgoing(segs[0], d.data) }));
    res.write(`data: ${JSON.stringify({ docs })}\n\n`);
  };
  send();
  const off = store.onChange((changed) => { if (changed === p) send(); });
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { off(); clearInterval(beat); });
});

router.get('/data/*', (req, res) => {
  const segs = parsePath(req.params[0]);
  if (!segs) return res.status(400).json({ error: 'bad path' });
  if (isCollection(segs)) {
    const docs = store.list(segs.join('/')).map((d) => ({ id: d.id, data: outgoing(segs[0], d.data) }));
    return res.json({ docs });
  }
  const id = segs[segs.length - 1];
  const doc = store.get(collPathOf(segs), id);
  res.json({ id, exists: !!doc, data: doc ? outgoing(segs[0], doc) : null });
});

router.post('/data/*', (req, res) => {
  const segs = parsePath(req.params[0]);
  if (!segs || !isCollection(segs)) return res.status(400).json({ error: 'bad path' });
  if (!canWrite(req.user, segs, 'POST', null)) return deny(res);
  const id = store.add(segs.join('/'), incoming(segs[0], req.body));
  res.status(201).json({ id });
});

router.put('/data/*', (req, res) => {
  const segs = parsePath(req.params[0]);
  if (!segs || isCollection(segs)) return res.status(400).json({ error: 'bad path' });
  const p = collPathOf(segs), id = segs[segs.length - 1];
  if (!canWrite(req.user, segs, 'PUT', store.get(p, id))) return deny(res);
  store.set(p, id, incoming(segs[0], req.body));
  res.json({ ok: true });
});

router.patch('/data/*', (req, res) => {
  const segs = parsePath(req.params[0]);
  if (!segs || isCollection(segs)) return res.status(400).json({ error: 'bad path' });
  const p = collPathOf(segs), id = segs[segs.length - 1];
  const existing = store.get(p, id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (!canWrite(req.user, segs, 'PATCH', existing)) return deny(res);
  store.update(p, id, incoming(segs[0], req.body));
  res.json({ ok: true });
});

router.delete('/data/*', (req, res) => {
  const segs = parsePath(req.params[0]);
  if (!segs || isCollection(segs)) return res.status(400).json({ error: 'bad path' });
  const p = collPathOf(segs), id = segs[segs.length - 1];
  if (!canWrite(req.user, segs, 'DELETE', store.get(p, id))) return deny(res);
  store.remove(p, id);
  res.json({ ok: true });
});

module.exports = router;
