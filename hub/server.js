const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const port = Number(process.env.PORT || 4090);
const password = process.env.HUB_PASSWORD || '';
const hubSecret = process.env.HUB_SECRET || '';
const cookieSecret = process.env.COOKIE_SECRET || hubSecret;
const tools = JSON.parse(fs.readFileSync(process.env.TOOLS_FILE || path.join(__dirname, 'tools.json'), 'utf8')).map((t) => ({ ...t, upstream: process.env[`TOOL_${t.id.toUpperCase()}_URL`] || t.upstream }));
const publicDir = path.join(__dirname, 'public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };

const sign = (v) => crypto.createHmac('sha256', cookieSecret).update(v).digest('hex');
function authed(req) {
  const raw = (req.headers.cookie || '').match(/hub_session=([^;]+)/)?.[1] || '';
  const [value, sig] = raw.split('.');
  return Boolean(value === 'ok' && sig && sig.length === sign('ok').length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign('ok'))));
}
function json(res, status, body, headers = {}) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(body)); }
async function readBody(req) { const c = []; for await (const x of req) c.push(x); return c.length ? JSON.parse(Buffer.concat(c).toString('utf8')) : {}; }

function proxy(req, res, tool, rest) {
  const target = new URL(tool.upstream);
  const headers = { ...req.headers, host: target.host, 'x-hub-secret': hubSecret };
  delete headers.cookie; // la sesión del hub no se reenvía; solo cookies propias de la herramienta
  const own = (req.headers.cookie || '').split(';').map((c) => c.trim()).filter((c) => c && !c.startsWith('hub_session=') && !c.startsWith('maquiavelo_session='));
  if (own.length) headers.cookie = own.join('; ');
  const upstream = http.request({ hostname: target.hostname, port: target.port || 80, path: rest, method: req.method, headers }, (up) => {
    const out = { ...up.headers };
    if (out.location && out.location.startsWith('/')) out.location = `/t/${tool.id}${out.location}`;
    if (out['set-cookie']) out['set-cookie'] = [].concat(out['set-cookie']).filter((c) => !/^maquiavelo_session=/.test(c));
    res.writeHead(up.statusCode, out); up.pipe(res);
  });
  upstream.setTimeout(60000, () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: `La herramienta "${tool.label}" no responde.` }); else res.end(); });
  req.pipe(upstream);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return json(res, 200, { ok: true });
  if (req.method === 'POST' && url.pathname === '/login') {
    const given = String((await readBody(req).catch(() => ({}))).password || '');
    const ok = password && given.length === password.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(password));
    if (!ok) return json(res, 401, { error: 'Contraseña incorrecta' });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return json(res, 200, { ok: true }, { 'set-cookie': `hub_session=ok.${sign('ok')}; HttpOnly; SameSite=Lax${secure}; Path=/; Max-Age=2592000` });
  }
  if (req.method === 'POST' && url.pathname === '/logout') return json(res, 200, { ok: true }, { 'set-cookie': 'hub_session=; HttpOnly; Path=/; Max-Age=0' });
  if (url.pathname === '/api/session') return json(res, authed(req) ? 200 : 401, { ok: authed(req) });
  if (url.pathname === '/api/tools') {
    if (!authed(req)) return json(res, 401, { error: 'No autorizado' });
    return json(res, 200, tools.map(({ id, label, icon }) => ({ id, label, icon })));
  }
  const m = url.pathname.match(/^\/t\/([a-z0-9-]+)(\/.*)?$/);
  if (m) {
    if (!authed(req)) return json(res, 401, { error: 'No autorizado' });
    const tool = tools.find((t) => t.id === m[1]);
    if (!tool) return json(res, 404, { error: 'Herramienta no encontrada' });
    if (!m[2]) { res.writeHead(301, { location: `/t/${tool.id}/` }); return res.end(); }
    return proxy(req, res, tool, m[2] + url.search);
  }
  const file = path.normalize(path.join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(publicDir)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not_found' });
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(data);
  });
}).listen(port, () => console.log(`hub listening on ${port}`));
