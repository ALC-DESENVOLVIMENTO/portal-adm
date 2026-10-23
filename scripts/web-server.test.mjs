import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createWebApp } from './web-server.mjs';

test('web/API separation preserves auth, uploads, errors, SSE and SPA routing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'alc-web-test-'));
  await writeFile(path.join(root, 'index.html'), '<html>ALC frontend</html>');
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/api/denied') { res.writeHead(401); return res.end('Unauthorized'); }
    if (req.url === '/api/events') { res.setHeader('Content-Type', 'text/event-stream'); res.write('data: ready\n\n'); return setTimeout(() => res.end('data: done\n\n'), 20); }
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Set-Cookie', ['session=example; HttpOnly; Secure; SameSite=Lax', 'csrf=example; Secure']);
    res.end(JSON.stringify({ method: req.method, url: req.url, cookie: req.headers.cookie, origin: req.headers.origin, host: req.headers.host, csrf: req.headers['x-csrf-token'], body }));
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const web = createWebApp({ backendUrl: `http://127.0.0.1:${upstream.address().port}`, webRoot: root, securityHeaders: { 'X-Frame-Options': 'DENY' } }).listen(0, '127.0.0.1');
  await once(web, 'listening');
  const url = `http://127.0.0.1:${web.address().port}`;
  try {
    const response = await fetch(url + '/api/upload?file=1', { method: 'POST', headers: { Cookie: 'session=example', Origin: 'https://portal.example', 'X-CSRF-Token': 'example', 'Content-Type': 'multipart/form-data; boundary=test' }, body: '--test\r\nexample upload\r\n--test--' });
    const data = await response.json();
    assert.equal(data.method, 'POST'); assert.equal(data.url, '/api/upload?file=1'); assert.equal(data.cookie, 'session=example'); assert.equal(data.origin, 'https://portal.example'); assert.equal(data.csrf, 'example'); assert.ok(data.body.includes('example upload')); assert.equal(data.host, new URL(url).host);
    assert.equal(response.headers.getSetCookie().length, 2);
    assert.equal((await fetch(url + '/api/denied')).status, 401);
    const sse = await fetch(url + '/api/events'); assert.match(sse.headers.get('content-type'), /event-stream/); assert.match(await sse.text(), /ready[\s\S]*done/);
    const page = await fetch(url + '/dashboard/drivers'); assert.match(await page.text(), /ALC frontend/); assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal((await fetch(url + '/assets/missing.js')).status, 404);
    assert.equal((await (await fetch(url + '/_web/health')).json()).role, 'web');
  } finally { web.closeAllConnections(); upstream.closeAllConnections(); await Promise.all([new Promise(resolve => web.close(resolve)), new Promise(resolve => upstream.close(resolve))]); await rm(root, { recursive: true }); }
});
