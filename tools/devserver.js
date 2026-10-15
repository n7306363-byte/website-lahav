#!/usr/bin/env node
'use strict';
/*
 * Local test server for the admin:  node tools/devserver.js  ->  http://localhost:8091/admin/
 * - serves the repo as static files
 * - mounts api/config.js and api/save.js
 * - fakes the GitHub API (commits are written to .dev-out/, nothing leaves the machine)
 * - dev sign-in works because ADMIN_DEV_MODE=1 and the host is localhost
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.ADMIN_DEV_MODE = '1';
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'fake';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id';
process.env.ALLOWED_EMAILS = process.env.ALLOWED_EMAILS || 'owner@example.com';

const root = path.join(__dirname, '..');
const outDir = path.join(root, '.dev-out');
const realFetch = global.fetch;

// ---- fake GitHub
const gh = { head: 'c0', commits: { c0: { tree: 't0' } }, blobs: {}, trees: {}, n: 0 };
const sha = () => crypto.randomBytes(8).toString('hex');
function json(body, status) { return Promise.resolve({ ok: (status || 200) < 400, status: status || 200, text: async () => JSON.stringify(body), json: async () => body }); }
global.fetch = async function (url, opts) {
  url = String(url);
  const m = /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+(\/.*)$/.exec(url);
  if (!m) return realFetch(url, opts);
  const p = m[1].split('?')[0];
  const method = (opts && opts.method) || 'GET';
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  if (p === '/contents/template.html') {
    const text = fs.readFileSync(path.join(root, 'template.html'), 'utf8');
    return { ok: true, status: 200, text: async () => text };
  }
  if (p.startsWith('/git/ref/heads/')) return json({ object: { sha: gh.head } });
  if (p.startsWith('/git/commits/') && method === 'GET') return json({ tree: { sha: gh.commits[gh.head].tree } });
  if (p === '/git/blobs') { const s = sha(); gh.blobs[s] = Buffer.from(body.content, 'base64'); return json({ sha: s }, 201); }
  if (p === '/git/trees') { const s = sha(); gh.trees[s] = body.tree; return json({ sha: s }, 201); }
  if (p === '/git/commits' && method === 'POST') { const s = sha(); gh.commits[s] = { tree: body.tree, parents: body.parents, message: body.message }; return json({ sha: s }, 201); }
  if (p.startsWith('/git/refs/heads/') && method === 'PATCH') {
    const c = gh.commits[body.sha];
    if (!c || c.parents[0] !== gh.head) return json({ message: 'Update is not a fast forward' }, 422);
    gh.head = body.sha;
    (gh.trees[c.tree] || []).forEach(e => {
      const f = path.join(outDir, e.path); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, gh.blobs[e.sha]);
    });
    console.log('[fake github] commit', body.sha, JSON.stringify(c.message), (gh.trees[c.tree] || []).map(e => e.path).join(', '));
    return json({ ref: 'refs/heads/main' });
  }
  return json({ message: 'unhandled ' + method + ' ' + p }, 404);
};

const handlers = { '/api/config': require('../api/config'), '/api/save': require('../api/save') };
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const h = handlers[u.pathname];
  if (h) {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body; try { body = raw ? JSON.parse(raw) : undefined; } catch (e) { body = raw; }
      const rq = { method: req.method, headers: req.headers, body };
      const rs = {
        setHeader: (k, v) => res.setHeader(k, v),
        status(n) { res.statusCode = n; return rs; },
        json(o) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); },
      };
      try { await h(rq, rs); } catch (e) { console.error(e); res.statusCode = 500; res.end('error'); }
    });
    return;
  }
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(f).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(8091, '127.0.0.1', () => console.log('dev server: http://localhost:8091/admin/'));
