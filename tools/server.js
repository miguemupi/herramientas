import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4087);
const appMode = process.env.APP_MODE || 'events';
const wpApiNamespace = process.env.WP_API_NAMESPACE || 'maquiavelo-eventos/v1';
const accessCode = process.env.ACCESS_CODE || '';
const wpBase = (process.env.WP_BASE_URL || '').replace(/\/$/, '');
const wpCacheTtlMs = Number(process.env.WP_CACHE_TTL_MS || 30000);
const wpCache = new Map();
const cookieSecret = process.env.COOKIE_SECRET || crypto.createHash('sha256').update(`${accessCode}|${process.env.WP_USER || ''}|${process.env.WP_APP_PASSWORD || ''}`).digest('hex');
const logDir = path.join(root, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'activity.log');
const dataDir = path.join(root, 'data');
const businessFile = path.join(dataDir, 'businesses.json');
fs.mkdirSync(dataDir, { recursive: true });
const defaultBusiness = { id: 'maquiavelo', name: process.env.BUSINESS_NAME || 'Maquiavelo Sevilla', wpBaseUrl: wpBase, wpUser: process.env.WP_USER || '', wpAppPassword: process.env.WP_APP_PASSWORD || '', wpApiNamespace };
let businesses = {};
try { businesses = JSON.parse(fs.readFileSync(businessFile, 'utf8')); } catch { businesses = {}; }

function logActivity(action, details = {}) {
  const safeDetails = JSON.stringify(details);
  fs.appendFile(logFile, `${new Date().toISOString()} ${action} ${safeDetails}\n`, () => {});
}

function sign(value) { return crypto.createHmac('sha256', cookieSecret).update(value).digest('hex'); }
function encrypt(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(cookieSecret).digest(), iv); const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]); return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`; }
function decrypt(value) { try { const [iv, tag, encrypted] = String(value).split('.').map((part) => Buffer.from(part, 'base64')); const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(cookieSecret).digest(), iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'); } catch { return ''; } }
function saveBusinesses() { fs.writeFileSync(businessFile, JSON.stringify(businesses, null, 2)); }
function businessConfig(id) { if (!id || id === defaultBusiness.id) return defaultBusiness; const stored = businesses[id]; if (!stored) return null; return { ...stored, wpAppPassword: decrypt(stored.wpAppPasswordEncrypted) }; }
function selectedBusiness(req) { const id = (req.headers.cookie || '').match(/serendipia_business=([^;]+)/)?.[1] || defaultBusiness.id; return businessConfig(id) || defaultBusiness; }
function publicBusiness(business) { return { id: business.id, name: business.name, wpBaseUrl: business.wpBaseUrl, wpApiNamespace: business.wpApiNamespace }; }
function isAuthed(req) {
  if (process.env.HUB_SECRET && req.headers['x-hub-secret'] === process.env.HUB_SECRET) return true;
  const raw = (req.headers.cookie || '').match(/maquiavelo_session=([^;]+)/)?.[1] || '';
  const [value, signature] = raw.split('.');
  return Boolean(value && signature && signature.length === sign(value).length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(value))) && value === 'ok');
}
function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
async function wp(pathname, options = {}, business = defaultBusiness) {
  try {
    const wpAuth = Buffer.from(`${business.wpUser}:${business.wpAppPassword}`).toString('base64');
    const response = await fetch(`${business.wpBaseUrl}${pathname}`, { ...options, signal: AbortSignal.timeout(30000), headers: { authorization: `Basic ${wpAuth}`, 'content-type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch (error) {
    logActivity('wordpress_network_error', { path: pathname, message: error.message });
    return { status: 502, data: { code: 'wordpress_unreachable', message: 'No se pudo conectar con WordPress. Revisa WP_BASE_URL y la red del contenedor.' } };
  }
}
async function wpCached(pathname, business = defaultBusiness) {
  const cacheKey = `${business.id}:${pathname}`; const now = Date.now(); const cached = wpCache.get(cacheKey);
  if (cached && cached.expiresAt > now) { logActivity('wordpress_cache_hit', { path: pathname }); return cached.result; }
  const result = await wp(pathname, { method: 'GET' }, business);
  if (result.status >= 200 && result.status < 300) wpCache.set(cacheKey, { expiresAt: now + wpCacheTtlMs, result });
  return result;
}
function clearWpCache() { wpCache.clear(); logActivity('wordpress_cache_cleared'); }
async function uploadMedia(media, business = defaultBusiness) {
  const filename = String(media.filename || 'imagen-evento.jpg').replace(/[^a-zA-Z0-9._-]/g, '-');
  const wpAuth = Buffer.from(`${business.wpUser}:${business.wpAppPassword}`).toString('base64');
  const response = await fetch(`${business.wpBaseUrl}/wp-json/wp/v2/media`, { method: 'POST', headers: { authorization: `Basic ${wpAuth}`, 'content-type': media.type || 'application/octet-stream', 'content-disposition': `attachment; filename="${filename}"` }, body: Buffer.from(String(media.data || ''), 'base64') });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}
function staticFile(res, pathname) {
  const requested = pathname === '/' ? (appMode === 'popups' ? '/popups.html' : '/index.html') : pathname;
  const base = path.resolve(root, 'public');
  const file = path.resolve(base, `.${requested}`);
  if (!file.startsWith(base)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (error, data) => {
    if (error) return json(res, 404, { error: 'not_found' });
    const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' }); res.end(data);
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && url.pathname === '/auth') {
    const submitted = String((await body(req)).code || '');
    if (!accessCode || submitted !== accessCode) return json(res, 401, { error: 'Código incorrecto' });
    const value = `ok.${sign('ok')}`;
    logActivity('login_ok');
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return json(res, 200, { ok: true }, { 'set-cookie': `maquiavelo_session=${value}; HttpOnly; SameSite=Lax${secure}; Path=/; Max-Age=2592000` });
  }
  if (req.method === 'GET' && url.pathname === '/auth/check') return json(res, isAuthed(req) ? 200 : 401, { ok: isAuthed(req) });
  if (url.pathname === '/api/businesses' && req.method === 'GET') {
    if (!isAuthed(req)) return json(res, 401, { error: 'No autorizado' });
    return json(res, 200, [publicBusiness(defaultBusiness), ...Object.values(businesses).map((business) => publicBusiness(business))]);
  }
  if (url.pathname === '/api/businesses' && req.method === 'POST') {
    if (!isAuthed(req)) return json(res, 401, { error: 'No autorizado' });
    const input = await body(req); const name = String(input.name || '').trim(); const baseUrl = String(input.wpBaseUrl || '').replace(/\/$/, '');
    if (!name || !/^https?:\/\//i.test(baseUrl) || !input.wpUser || !input.wpAppPassword) return json(res, 400, { error: 'Completa nombre, URL, usuario y contraseña de aplicación.' });
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'negocio'}-${Date.now().toString(36)}`;
    const business = { id, name, wpBaseUrl: baseUrl, wpUser: String(input.wpUser), wpApiNamespace: String(input.wpApiNamespace || 'serendipia-popups/v1'), wpAppPasswordEncrypted: encrypt(input.wpAppPassword) };
    businesses[id] = business; saveBusinesses(); clearWpCache(); logActivity('business_created', { id, name, wpBaseUrl: baseUrl });
    return json(res, 201, publicBusiness(business), { 'set-cookie': `serendipia_business=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
  }
  if (url.pathname === '/api/select-business' && req.method === 'POST') {
    if (!isAuthed(req)) return json(res, 401, { error: 'No autorizado' });
    const id = String((await body(req)).id || ''); if (id !== defaultBusiness.id && !businesses[id]) return json(res, 404, { error: 'Negocio no encontrado' });
    clearWpCache(); return json(res, 200, publicBusiness(businessConfig(id)), { 'set-cookie': `serendipia_business=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
  }
  if (req.method === 'GET' && url.pathname === '/image-proxy') {
    if (!isAuthed(req)) return json(res, 401, { error: 'No autorizado' });
    try {
      const imageUrl = new URL(url.searchParams.get('url') || '');
      const allowedOrigins = [defaultBusiness, ...Object.values(businesses)].map((business) => new URL(business.wpBaseUrl).origin);
      if (!allowedOrigins.includes(imageUrl.origin)) return json(res, 403, { error: 'Origen de imagen no permitido' });
      const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
      if (!imageResponse.ok) return json(res, imageResponse.status, { error: 'No se pudo cargar la imagen' });
      const imageData = Buffer.from(await imageResponse.arrayBuffer());
      res.writeHead(200, { 'content-type': imageResponse.headers.get('content-type') || 'image/jpeg', 'cache-control': 'private, max-age=300' });
      return res.end(imageData);
    } catch (error) {
      return json(res, 400, { error: 'URL de imagen no válida' });
    }
  }
  if (url.pathname === '/health') return json(res, 200, { ok: true });
  if (url.pathname === '/api/media' && req.method === 'POST') {
    if (!isAuthed(req)) return json(res, 401, { error: 'No autorizado' });
    logActivity('media_upload_started');
    const result = await uploadMedia(await body(req), selectedBusiness(req));
    logActivity(result.status >= 200 && result.status < 300 ? 'media_upload_ok' : 'media_upload_error', { status: result.status, code: result.data?.code || null, message: result.data?.message || null });
    return json(res, result.status, result.data);
  }
  if (url.pathname === '/api/pages' && req.method === 'GET') {
    if (!isAuthed(req)) return json(res, 401, { error: 'No autorizado' });
    const business = selectedBusiness(req);
    const search = url.searchParams.get('search') || '';
    const query = new URLSearchParams({ per_page: '100', orderby: 'title', order: 'asc', _fields: 'id,link,title,slug,status' });
    if (search) query.set('search', search);
    const result = await wpCached(`/wp-json/wp/v2/pages?${query.toString()}`, business);
    return json(res, result.status, result.data);
  }
  if (url.pathname.startsWith('/api/')) {
    if (!isAuthed(req)) return json(res, 401, { error: 'No autorizado' });
    const business = selectedBusiness(req);
    const target = url.pathname.replace(/^\/api/, '') + (url.search || '');
    const payload = ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(await body(req));
    if (req.method !== 'GET') logActivity('wordpress_request', { method: req.method, path: target });
    const result = req.method === 'GET' ? await wpCached(`/wp-json/${business.wpApiNamespace}${target}`, business) : await wp(`/wp-json/${business.wpApiNamespace}${target}`, { method: req.method, body: payload }, business);
    if (req.method !== 'GET' && result.status >= 200 && result.status < 300) clearWpCache();
    if (result.status >= 400) logActivity('wordpress_response_error', { method: req.method, path: target, status: result.status, code: result.data?.code || null, message: result.data?.message || null });
    return json(res, result.status, result.data);
  }
  staticFile(res, url.pathname);
});
server.listen(port, () => console.log(`${appMode} dashboard listening on ${port}`));
