// Plantilla de herramienta para el hub. Sin dependencias.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const port = Number(process.env.PORT || 4100);
const accessCode = process.env.ACCESS_CODE || '';      // login propio (uso directo, fuera del hub)
const hubSecret = process.env.HUB_SECRET || '';        // mismo valor que en el hub
const cookieSecret = process.env.COOKIE_SECRET || hubSecret || accessCode;
const publicDir = path.join(__dirname, 'public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const sign = (v) => crypto.createHmac('sha256', cookieSecret).update(v).digest('hex');
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function isAuthed(req) {
  // 1) Petición que llega a través del hub: ya autenticada allí.
  if (hubSecret && safeEqual(String(req.headers['x-hub-secret'] || ''), hubSecret)) return true;
  // 2) Acceso directo: cookie firmada tras el login propio.
  const raw = (req.headers.cookie || '').match(/tool_session=([^;]+)/)?.[1] || '';
  const [value, sig] = raw.split('.');
  return Boolean(value === 'ok' && sig && safeEqual(sig, sign('ok')));
}
function json(res, status, body, headers = {}) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(body)); }
async function readBody(req) { const c = []; for await (const x of req) c.push(x); return c.length ? JSON.parse(Buffer.concat(c).toString('utf8')) : {}; }

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return json(res, 200, { ok: true });

  // Las rutas del cliente son RELATIVAS (fetch('auth'), fetch('api/datos')) para funcionar bajo /t/<id>/.
  if (req.method === 'POST' && url.pathname === '/auth') {
    const given = String((await readBody(req).catch(() => ({}))).code || '');
    if (!accessCode || !safeEqual(given, accessCode)) return json(res, 401, { error: 'Código incorrecto' });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return json(res, 200, { ok: true }, { 'set-cookie': `tool_session=ok.${sign('ok')}; HttpOnly; SameSite=Lax${secure}; Path=/; Max-Age=2592000` });
  }
  if (url.pathname === '/auth/check') return json(res, isAuthed(req) ? 200 : 401, { ok: isAuthed(req) });

  if (url.pathname.startsWith('/api/')) {
    if (!isAuthed(req)) return json(res, 401, { error: 'No autorizado' });
    if (url.pathname === '/api/ejemplo') return json(res, 200, { mensaje: 'Hola desde la herramienta' });
    return json(res, 404, { error: 'not_found' });
  }

  const file = path.normalize(path.join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(publicDir)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not_found' });
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
}).listen(port, () => console.log(`herramienta escuchando en ${port}`));
