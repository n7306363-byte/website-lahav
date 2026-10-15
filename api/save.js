'use strict';
/*
 * POST /api/save   Authorization: Bearer <Google ID token>
 * body: { content: {...}, uploads: [{ path: "images/uploads/x.jpg", data: "<base64>" }] }
 * Verifies the Google account, validates the content, renders index.html from template.html
 * and commits content.json + index.html (+ uploaded photos) to GitHub in ONE commit.
 * Vercel redeploys the static site from that commit (~30s).
 *
 * Environment variables (Vercel -> Settings -> Environment Variables):
 *   GOOGLE_CLIENT_ID   OAuth client id (web) used by the admin page
 *   ALLOWED_EMAILS     comma separated Google emails that may edit
 *   GITHUB_TOKEN       fine-grained token, repository contents: read & write
 *   GITHUB_REPO        optional, default n7306363-byte/website-lahav
 *   GITHUB_BRANCH      optional, default main
 */
const { render, validate } = require('../lib/render');

const REPO = process.env.GITHUB_REPO || 'n7306363-byte/website-lahav';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const MAX_UPLOAD = 1.6 * 1024 * 1024;
const MAX_TOTAL = 3.8 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function verifyGoogle(authHeader, host) {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || '');
  if (!m) throw new HttpError(401, 'לא מחובר');
  const token = m[1];
  const allowed = String(process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(String(host || ''));
  if (token === 'dev' && local && process.env.ADMIN_DEV_MODE === '1') return 'dev@localhost';
  if (!process.env.GOOGLE_CLIENT_ID) throw new HttpError(500, 'GOOGLE_CLIENT_ID לא הוגדר ב-Vercel');
  if (!allowed.length) throw new HttpError(500, 'ALLOWED_EMAILS לא הוגדר ב-Vercel');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token));
  if (!r.ok) throw new HttpError(401, 'ההתחברות פגה או לא תקינה, התחבר שוב');
  const info = await r.json();
  if (info.aud !== process.env.GOOGLE_CLIENT_ID) throw new HttpError(401, 'הטוקן לא שייך לאתר הזה');
  if (String(info.email_verified) !== 'true') throw new HttpError(401, 'האימייל לא מאומת');
  if (Number(info.exp) * 1000 < Date.now()) throw new HttpError(401, 'ההתחברות פגה, התחבר שוב');
  const email = String(info.email || '').toLowerCase();
  if (!allowed.includes(email)) throw new HttpError(403, 'לחשבון ' + email + ' אין הרשאת עריכה');
  return email;
}

function gh(path, opts) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new HttpError(500, 'GITHUB_TOKEN לא הוגדר ב-Vercel');
  return fetch('https://api.github.com/repos/' + REPO + path, Object.assign({}, opts, {
    headers: Object.assign({
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lahav-admin',
    }, (opts && opts.headers) || {}),
  }));
}
async function ghJson(path, opts) {
  const r = await gh(path, opts);
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  if (!r.ok) {
    const err = new HttpError(r.status === 422 || r.status === 409 ? 409 : 502, 'GitHub: ' + (data.message || r.status));
    err.github = r.status; throw err;
  }
  return data;
}

function checkUploads(uploads, content) {
  const list = Array.isArray(uploads) ? uploads : [];
  const out = [];
  let total = 0;
  for (const u of list) {
    if (!u || typeof u.path !== 'string' || typeof u.data !== 'string') throw new HttpError(400, 'קובץ תמונה לא תקין');
    if (!/^images\/uploads\/[A-Za-z0-9_-]{1,80}\.jpg$/.test(u.path)) throw new HttpError(400, 'שם קובץ לא תקין: ' + u.path);
    const buf = Buffer.from(u.data, 'base64');
    if (buf.length < 100 || buf.length > MAX_UPLOAD) throw new HttpError(400, 'התמונה גדולה מדי או ריקה: ' + u.path);
    // JPEG magic number
    if (!(buf[0] === 0xff && buf[1] === 0xd8)) throw new HttpError(400, 'הקובץ אינו JPEG: ' + u.path);
    total += buf.length;
    out.push({ path: u.path, buf });
  }
  if (total > MAX_TOTAL) throw new HttpError(413, 'סך התמונות גדול מדי לשמירה אחת, שמור בכמה שלבים');
  return out;
}

async function commitFiles(files, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ref = await ghJson('/git/ref/heads/' + BRANCH);
      const head = ref.object.sha;
      const commit = await ghJson('/git/commits/' + head);
      const entries = [];
      for (const f of files) {
        const blob = await ghJson('/git/blobs', { method: 'POST', body: JSON.stringify({ content: f.buf.toString('base64'), encoding: 'base64' }) });
        entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const tree = await ghJson('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries }) });
      const nc = await ghJson('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [head] }) });
      await ghJson('/git/refs/heads/' + BRANCH, { method: 'PATCH', body: JSON.stringify({ sha: nc.sha, force: false }) });
      return nc.sha;
    } catch (e) {
      if (e.status === 409 && attempt === 0) continue; // somebody pushed in between: retry on top of the new head
      throw e;
    }
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST בלבד');
    const email = await verifyGoogle(req.headers.authorization, req.headers.host);
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { throw new HttpError(400, 'בקשה לא תקינה'); } }
    if (!body || typeof body !== 'object') throw new HttpError(400, 'בקשה ריקה');

    let content;
    try { content = validate(body.content); } catch (e) { throw new HttpError(400, e.message); }
    const uploads = checkUploads(body.uploads, content);

    // the page layout lives in template.html in the repo
    const tr = await gh('/contents/template.html?ref=' + encodeURIComponent(BRANCH), { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!tr.ok) throw new HttpError(502, 'לא הצלחתי לקרוא את template.html מגיטהאב (' + tr.status + ')');
    const template = await tr.text();
    let html;
    try { html = render(template, content); } catch (e) { throw new HttpError(500, 'שגיאת בנייה: ' + e.message); }

    const files = [
      { path: 'content.json', buf: Buffer.from(JSON.stringify(content, null, 2) + '\n', 'utf8') },
      { path: 'index.html', buf: Buffer.from(html, 'utf8') },
    ].concat(uploads);
    const sha = await commitFiles(files, 'Admin: update site content (' + email + ')');
    res.status(200).json({ ok: true, commit: sha, files: files.map(f => f.path) });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ ok: false, error: e.message || 'שגיאה לא צפויה' });
  }
};
module.exports.config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };
