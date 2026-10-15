'use strict';
// GET /api/config -> what the admin page needs before sign-in (nothing secret)
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const host = String(req.headers.host || '');
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GITHUB_TOKEN && process.env.ALLOWED_EMAILS),
    devMode: local && process.env.ADMIN_DEV_MODE === '1',
  });
};
