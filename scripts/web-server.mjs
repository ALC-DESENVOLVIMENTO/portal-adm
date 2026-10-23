import express from 'express';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

export function createWebApp({ backendUrl, webRoot, securityHeaders = {} }) {
  const target = new URL(backendUrl);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/') throw new Error('Invalid API backend URL');
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/_web/health', (_req, res) => res.json({ ok: true, role: 'web' }));
  app.use((req, res, next) => {
    const pathname = req.path;
    if (!(pathname === '/api' || pathname.startsWith('/api/') || pathname === '/storage' || pathname.startsWith('/storage/'))) return next();
    const headers = { ...req.headers };
    // Retain the public Host/Origin and cookies for existing SSO and CSRF checks.
    delete headers.connection;
    const upstream = (target.protocol === 'https:' ? https : http).request(target, {
      method: req.method, path: req.originalUrl, headers,
    }, (response) => {
      const responseHeaders = { ...response.headers };
      delete responseHeaders.connection;
      res.writeHead(response.statusCode || 502, responseHeaders);
      response.pipe(res);
      response.on('error', () => res.destroy());
    });
    const timer = setTimeout(() => upstream.destroy(new Error('Backend response timeout')), 120000);
    upstream.once('response', () => clearTimeout(timer));
    upstream.once('error', () => {
      clearTimeout(timer);
      if (!res.headersSent) res.status(502).json({ error: 'API temporariamente indisponível.' });
      else res.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { clearTimeout(timer); upstream.destroy(); });
    req.pipe(upstream);
  });
  app.use(express.static(webRoot, {
    dotfiles: 'deny',
    setHeaders(res, file) {
      res.setHeader('Cache-Control', file.endsWith('index.html') ? 'no-store' : file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/assets/') || path.extname(req.path)) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(webRoot, 'index.html'));
  });
  return app;
}

export function startWeb() {
  if (!process.env.API_BACKEND_URL) throw new Error('API_BACKEND_URL is required for web role');
  const securityHeaders = JSON.parse(process.env.WEB_SECURITY_HEADERS || '{}');
  createWebApp({ backendUrl: process.env.API_BACKEND_URL, webRoot: path.resolve(process.env.STATIC_WEB_ROOT || 'dist'), securityHeaders })
    .listen(Number(process.env.PORT || 8080), '::', () => console.log('Web frontend ready; API forwarded to private backend.'));
}
