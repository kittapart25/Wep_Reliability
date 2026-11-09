// Hybrid document store:
// 1. If MONGODB_URI is provided, connects to MongoDB (Atlas / self-hosted) and syncs data permanently.
// 2. If MONGODB_URI is empty, falls back gracefully to local file-based storage (DATA_FILE).
// All data operations keep an in-memory cache for ultra-fast, synchronous Firestore-like API compatibility.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { DATA_FILE, MONGODB_URI } = require('./config');

let state = { collections: {}, sessions: {} };
let saveTimer = null;
const listeners = new Set();
let mongoClient = null;
let mongoDb = null;
let isMongoConnected = false;

function coll(p) {
  return state.collections[p] || (state.collections[p] = {});
}

function notify(collPath) {
  listeners.forEach((fn) => {
    try { fn(collPath); } catch (e) { console.error('Listener error:', e); }
  });
}

function saveLocal() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
      console.error('Failed to write local backup:', e.message);
    }
  }, 100);
}

// Persist document to MongoDB in background
async function persistMongoDoc(collPath, id, data) {
  if (!isMongoConnected || !mongoDb) return;
  try {
    const mongoColl = mongoDb.collection('documents');
    if (data === null) {
      await mongoColl.deleteOne({ collPath, docId: id });
    } else {
      await mongoColl.updateOne(
        { collPath, docId: id },
        { $set: { collPath, docId: id, data, updatedAt: new Date() } },
        { upsert: true }
      );
    }
  } catch (e) {
    console.error(`MongoDB sync error [${collPath}/${id}]:`, e.message);
  }
}

// Persist session to MongoDB in background
async function persistMongoSession(token, sessionData) {
  if (!isMongoConnected || !mongoDb) return;
  try {
    const mongoColl = mongoDb.collection('sessions');
    if (sessionData === null) {
      await mongoColl.deleteOne({ token });
    } else {
      await mongoColl.updateOne(
        { token },
        { $set: { token, ...sessionData, updatedAt: new Date() } },
        { upsert: true }
      );
    }
  } catch (e) {
    console.error('MongoDB session sync error:', e.message);
  }
}

async function load() {
  // 1. Initial load from local file cache if present
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      state.collections = parsed.collections || {};
      state.sessions = parsed.sessions || {};
    }
  } catch (e) {
    console.warn('Could not read local DATA_FILE, starting fresh:', e.message);
  }

  // 2. If MONGODB_URI is provided, connect and pull latest data
  if (MONGODB_URI) {
    console.log('Connecting to MongoDB...');
    try {
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      mongoDb = mongoClient.db();
      isMongoConnected = true;
      console.log(' Connected to MongoDB successfully!');

      // Load all documents from MongoDB into memory state
      const docsColl = mongoDb.collection('documents');
      const docs = await docsColl.find({}).toArray();
      if (docs.length > 0) {
        state.collections = {};
        for (const item of docs) {
          if (item.collPath && item.docId) {
            if (!state.collections[item.collPath]) {
              state.collections[item.collPath] = {};
            }
            state.collections[item.collPath][item.docId] = item.data;
          }
        }
        console.log(`Loaded ${docs.length} documents from MongoDB.`);
      }

      // Load active sessions
      const sessionsColl = mongoDb.collection('sessions');
      const sessions = await sessionsColl.find({}).toArray();
      if (sessions.length > 0) {
        state.sessions = {};
        for (const s of sessions) {
          if (s.token) {
            const { _id, token, updatedAt, ...sessionData } = s;
            state.sessions[token] = sessionData;
          }
        }
        console.log(`Loaded ${sessions.length} sessions from MongoDB.`);
      }

      saveLocal(); // sync local cache
    } catch (err) {
      console.error(' MongoDB connection failed! Falling back to local db.json:', err.message);
      isMongoConnected = false;
    }
  } else {
    console.log('ℹ️ MONGODB_URI not set. Running with local db.json storage.');
  }
}

const store = {
  load,
  newId: () => crypto.randomBytes(10).toString('base64url'),
  list: (p) => Object.entries(coll(p)).map(([id, data]) => ({ id, data })),
  get: (p, id) => coll(p)[id] || null,
  set(p, id, data) {
    coll(p)[id] = data;
    saveLocal();
    persistMongoDoc(p, id, data);
    notify(p);
  },
  add(p, data) {
    const id = store.newId();
    store.set(p, id, data);
    return id;
  },
  update(p, id, patch) {
    const cur = coll(p)[id];
    if (!cur) return false;
    const updated = { ...cur, ...patch };
    coll(p)[id] = updated;
    saveLocal();
    persistMongoDoc(p, id, updated);
    notify(p);
    return true;
  },
  remove(p, id) {
    delete coll(p)[id];
    saveLocal();
    persistMongoDoc(p, id, null);
    notify(p);
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  sessions: {
    get: (t) => state.sessions[t] || null,
    set(t, v) {
      state.sessions[t] = v;
      saveLocal();
      persistMongoSession(t, v);
    },
    delete(t) {
      delete state.sessions[t];
      saveLocal();
      persistMongoSession(t, null);
    },
  },
};

module.exports = store;
