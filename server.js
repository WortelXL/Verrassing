// Babyverrassing – kleine webserver zonder externe afhankelijkheden
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '80', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- opslag ----------
function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return { salt, hash };
}
function checkPin(pin, stored) {
  const { hash } = hashPin(pin, stored.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored.hash, 'hex'));
}

function defaultData() {
  return {
    settings: {
      name: process.env.SISTER_NAME || 'Zusje',
      title: 'Er komt een kleintje aan!',
      message: 'Wat zijn we blij voor jullie! We tellen samen af tot de grote dag.',
      dueDate: process.env.DUE_DATE || '2027-04-15',
      gender: 'onbekend', // onbekend | meisje | jongen
      babyName: '',
    },
    pin: hashPin(process.env.DEFAULT_PIN || '1234'),
    tasks: [],
    notes: '',
  };
}

let data;
function load() {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const d = defaultData();
    data.settings = { ...d.settings, ...(data.settings || {}) };
    data.tasks = data.tasks || [];
    data.notes = data.notes || '';
    if (!data.pin) data.pin = d.pin;
  } catch {
    data = defaultData();
    save();
  }
}
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
load();

// ---------- sessies & brute-force bescherming ----------
const sessions = new Map(); // token -> verloopt
const SESSION_MS = 12 * 60 * 60 * 1000;
const attempts = new Map(); // ip -> { count, until }

function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function isAuthed(req) {
  const t = getCookie(req, 'sid');
  if (!t || !sessions.has(t)) return false;
  if (sessions.get(t) < Date.now()) { sessions.delete(t); return false; }
  return true;
}

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Ongeldige JSON')); } });
    req.on('error', reject);
  });
}
const str = (v, max = 500) => String(v ?? '').slice(0, max);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/instellingen' || pathname === '/admin') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Verboden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Niet gevonden');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------- routes ----------
async function handleApi(req, res, pathname) {
  const ip = req.socket.remoteAddress;

  if (pathname === '/api/public' && req.method === 'GET') {
    const { name, title, message, dueDate, gender, babyName } = data.settings;
    return send(res, 200, { name, title, message, dueDate, gender, babyName });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    const a = attempts.get(ip) || { count: 0, until: 0 };
    if (a.until > Date.now()) {
      return send(res, 429, { error: `Te veel pogingen. Probeer het over ${Math.ceil((a.until - Date.now()) / 60000)} min opnieuw.` });
    }
    const body = await readBody(req);
    if (checkPin(str(body.pin, 20), data.pin)) {
      attempts.delete(ip);
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, Date.now() + SESSION_MS);
      return send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` });
    }
    a.count += 1;
    if (a.count >= 5) { a.until = Date.now() + 5 * 60 * 1000; a.count = 0; }
    attempts.set(ip, a);
    return send(res, 401, { error: 'Onjuiste pincode' });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    sessions.delete(getCookie(req, 'sid'));
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
  }

  // Alles hieronder vereist pincode
  if (!isAuthed(req)) return send(res, 401, { error: 'Niet ingelogd' });

  if (pathname === '/api/state' && req.method === 'GET') {
    return send(res, 200, { settings: data.settings, tasks: data.tasks, notes: data.notes });
  }

  if (pathname === '/api/settings' && req.method === 'PUT') {
    const b = await readBody(req);
    const s = data.settings;
    if (b.name !== undefined) s.name = str(b.name, 60);
    if (b.title !== undefined) s.title = str(b.title, 120);
    if (b.message !== undefined) s.message = str(b.message, 500);
    if (b.babyName !== undefined) s.babyName = str(b.babyName, 60);
    if (b.dueDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)) return send(res, 400, { error: 'Ongeldige datum' });
      s.dueDate = b.dueDate;
    }
    if (b.gender !== undefined) {
      if (!['onbekend', 'meisje', 'jongen'].includes(b.gender)) return send(res, 400, { error: 'Ongeldig geslacht' });
      s.gender = b.gender;
    }
    save();
    return send(res, 200, { settings: s });
  }

  if (pathname === '/api/notes' && req.method === 'PUT') {
    const b = await readBody(req);
    data.notes = str(b.notes, 20000);
    save();
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/pin' && req.method === 'POST') {
    const b = await readBody(req);
    if (!checkPin(str(b.oldPin, 20), data.pin)) return send(res, 400, { error: 'Huidige pincode klopt niet' });
    if (!/^\d{4,8}$/.test(String(b.newPin || ''))) return send(res, 400, { error: 'Nieuwe pincode moet 4 t/m 8 cijfers zijn' });
    data.pin = hashPin(b.newPin);
    save();
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/tasks' && req.method === 'POST') {
    const b = await readBody(req);
    const text = str(b.text, 200).trim();
    if (!text) return send(res, 400, { error: 'Taak is leeg' });
    const task = { id: crypto.randomBytes(6).toString('hex'), text, done: false, category: str(b.category, 40), created: new Date().toISOString() };
    data.tasks.push(task);
    save();
    return send(res, 200, task);
  }

  const m = pathname.match(/^\/api\/tasks\/([a-f0-9]+)$/);
  if (m) {
    const idx = data.tasks.findIndex((t) => t.id === m[1]);
    if (idx < 0) return send(res, 404, { error: 'Taak niet gevonden' });
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      if (b.done !== undefined) data.tasks[idx].done = !!b.done;
      if (b.text !== undefined) data.tasks[idx].text = str(b.text, 200);
      save();
      return send(res, 200, data.tasks[idx]);
    }
    if (req.method === 'DELETE') {
      data.tasks.splice(idx, 1);
      save();
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'Onbekende route' });
}

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return serveStatic(req, res, decodeURIComponent(pathname));
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
}).listen(PORT, () => console.log(`Babyverrassing draait op poort ${PORT}`));
