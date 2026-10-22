'use strict';

// Response headers for every page and API reply. vercel.json repeats them for the
// static files Vercel serves straight from its CDN; test/vercel.test.js keeps the
// two in sync.
function securityHeaders({ https }) {
  const headers = [
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['X-Frame-Options', 'DENY'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    ['Permissions-Policy', 'geolocation=(), camera=(), microphone=()'],
    // Only our own scripts, no inline scripts. Images are our own uploads only, so
    // a listing can't load a tracking pixel.
    ['Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')],
  ];
  if (https) headers.push(['Strict-Transport-Security', 'max-age=31536000; includeSubDomains']);
  return headers;
}

module.exports = { securityHeaders };
