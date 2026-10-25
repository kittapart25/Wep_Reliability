// Frontend API client. Exposes `Api`, including a Firestore-style `Api.db`
// (collection/doc/get/set/update/add/delete/onSnapshot) so app.js stays simple.
(function () {
  const BASE = ((window.RELTEST_CONFIG || {}).API_BASE || '').replace(/\/$/, '');
  const TOKEN_KEY = 'reltest_token';

  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
  const setToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {} };
  const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} };

  async function request(method, path, body, opts = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    let payload;
    if (opts.raw) { payload = body; }
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

    let res;
    try { res = await fetch(BASE + '/api' + path, { method, headers, body: payload }); }
    catch (e) { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบว่า backend เปิดอยู่'); }

    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && token && !path.startsWith('/auth/login')) {
      clearToken(); location.reload();
    }
    if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
    return json;
  }

  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  const wrapDocs = (docs) => ({ docs: docs.map((d) => ({ id: d.id, data: () => d.data })) });

  class DocRef {
    constructor(path) { this.path = path; this.id = path.split('/').pop(); }
    async get() {
      const r = await request('GET', '/data/' + enc(this.path));
      return { id: r.id, exists: r.exists, data: () => r.data };
    }
    async set(data) { await request('PUT', '/data/' + enc(this.path), data); }
    async update(data) { await request('PATCH', '/data/' + enc(this.path), data); }
    async delete() { await request('DELETE', '/data/' + enc(this.path)); }
    collection(name) { return new CollRef(this.path + '/' + name); }
  }

  class CollRef {
    constructor(path) { this.path = path; }
    doc(id) { return new DocRef(this.path + '/' + id); }
    async get() {
      const r = await request('GET', '/data/' + enc(this.path));
      return wrapDocs(r.docs);
    }
    async add(data) {
      const r = await request('POST', '/data/' + enc(this.path), data);
      return new DocRef(this.path + '/' + r.id);
    }
    // live updates through Server-Sent Events; returns an unsubscribe function
    onSnapshot(onNext, onError) {
      const es = new EventSource(BASE + '/api/stream/' + enc(this.path) + '?token=' + encodeURIComponent(getToken() || ''));
      es.onmessage = (ev) => { try { onNext(wrapDocs(JSON.parse(ev.data).docs)); } catch (e) { if (onError) onError(e); } };
      es.onerror = () => { if (es.readyState === EventSource.CLOSED && onError) onError(new Error('stream closed')); };
      return () => es.close();
    }
  }

  window.Api = {
    db: {
      collection: (path) => new CollRef(path),
      doc: (path) => new DocRef(path),
    },
    hasToken: () => !!getToken(),
    clearToken,
    async login(empId, password) {
      const r = await request('POST', '/auth/login', { empId, password });
      setToken(r.token);
      return r.user;
    },
    async me() { return (await request('GET', '/auth/me')).user; },
    async logout() { try { await request('POST', '/auth/logout'); } catch (e) {} clearToken(); },
    changePassword: (currentPassword, newPassword) => request('POST', '/auth/change-password', { currentPassword, newPassword }),
    fileUrl: (url) => (/^https?:/.test(url) ? url : BASE + url),

    // replaces claude.use('assets')
    assets: {
      async upload(file) {
        return request('POST', '/upload?filename=' + encodeURIComponent(file.name), file, { raw: true });
      },
    },
    // replaces claude.use('downloads')
    downloads: {
      async save({ filename, data }) {
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
    },
  };
})();
