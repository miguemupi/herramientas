// Prepara los binarios que no viajan en git: descarga Poppins y decodifica los *.b64.
const fs = require('fs');
const path = require('path');
const FONTS = {
  "poppins-400-latin-ext.woff2": "https://fonts.gstatic.com/s/poppins/v24/pxiEyp8kv8JHgFVrJJnecmNE.woff2",
  "poppins-400-latin.woff2": "https://fonts.gstatic.com/s/poppins/v24/pxiEyp8kv8JHgFVrJJfecg.woff2",
  "poppins-500-latin-ext.woff2": "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLGT9Z1JlFc-K.woff2",
  "poppins-500-latin.woff2": "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLGT9Z1xlFQ.woff2",
  "poppins-600-latin-ext.woff2": "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLEj6Z1JlFc-K.woff2",
  "poppins-600-latin.woff2": "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLEj6Z1xlFQ.woff2",
  "poppins-700-latin-ext.woff2": "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7Z1JlFc-K.woff2",
  "poppins-700-latin.woff2": "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7Z1xlFQ.woff2"
};
const root = path.join(__dirname, 'public');
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])); }
(async () => {
  for (const f of walk(root).filter((p) => p.endsWith('.b64'))) fs.writeFileSync(f.slice(0, -4), Buffer.from(fs.readFileSync(f, 'utf8'), 'base64'));
  fs.mkdirSync(path.join(root, 'fonts'), { recursive: true });
  for (const [name, url] of Object.entries(FONTS)) {
    const r = await fetch(url); if (!r.ok) throw new Error(`No se pudo descargar ${url}: ${r.status}`);
    fs.writeFileSync(path.join(root, 'fonts', name), Buffer.from(await r.arrayBuffer()));
  }
  console.log('assets listos');
})().catch((e) => { console.error(e); process.exit(1); });
