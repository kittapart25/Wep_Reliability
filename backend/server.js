const express = require('express');
const cors = require('cors');
const config = require('./src/config');
const store = require('./src/store');

store.load();
require('./src/seed')();

const app = express();
app.use(cors()); // lets the frontend run from VS Code Live Server (another port) too
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', express.json({ limit: '1mb' }), require('./src/routes/auth.routes'));
app.use('/api', express.json({ limit: '1mb' }), require('./src/routes/data.routes'));
app.use('/api', require('./src/routes/upload.routes'));

// uploaded invoices (random, unguessable file names)
app.use('/uploads', express.static(config.UPLOAD_DIR, { setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));

// serve the frontend too, so `npm start` is all you need
app.use(express.static(config.FRONTEND_DIR));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(config.PORT, () => {
  console.log(`RelTest Lab running at http://localhost:${config.PORT}`);
});
