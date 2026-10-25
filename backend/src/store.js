// Tiny JSON-file document store (collections of documents, Firestore-like paths).
// Swap this module for a real database (PostgreSQL, MongoDB, ...) later;
// the routes only use the functions exported here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_FILE } = require('./config');

let state = { collections: {}, sessions: {} };
let saveTimer = null;
const listeners = new Set();

function load() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    state.collections = parsed.collections || {};
    state.sessions = parsed.sessions || {};
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, DATA_FILE);
  }, 100);
}

function coll(p) {
  return state.collections[p] || (state.collections[p] = {});
}
function notify(collPath) {
  listeners.forEach((fn) => fn(collPath));
}

const store = {
  load,
  newId: () => crypto.randomBytes(10).toString('base64url'),
  list: (p) => Object.entries(coll(p)).map(([id, data]) => ({ id, data })),
  get: (p, id) => coll(p)[id] || null,
  set(p, id, data) {
    coll(p)[id] = data;
    save(); notify(p);
  },
  add(p, data) {
    const id = store.newId();
    store.set(p, id, data);
    return id;
  },
  update(p, id, patch) {
    const cur = coll(p)[id];
    if (!cur) return false;
    coll(p)[id] = { ...cur, ...patch };
    save(); notify(p);
    return true;
  },
  remove(p, id) {
    delete coll(p)[id];
    save(); notify(p);
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  // sessions (kept in the same file so logins survive restarts)
  sessions: {
    get: (t) => state.sessions[t] || null,
    set(t, v) { state.sessions[t] = v; save(); },
    delete(t) { delete state.sessions[t]; save(); },
  },
};

module.exports = store;
