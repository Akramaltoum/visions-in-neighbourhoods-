'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vercel = require('../vercel.json');
const { securityHeaders } = require('../src/lib/security-headers');

describe('vercel hosting', () => {
  test('static files get the same security headers as the app', () => {
    const block = vercel.headers.find((h) => h.source === '/(.*)');
    const fromVercel = block.headers.map(({ key, value }) => [key, value]);
    assert.deepEqual(fromVercel, securityHeaders({ https: true }));
  });

  test('every /api route except rescore reaches the Node app', () => {
    const rule = vercel.rewrites.find((r) => r.destination === '/api' && r.source.startsWith('/api/'));
    const re = /^\/api\/((?!rescore$).*)$/;
    assert.equal(rule.source, '/api/:path((?!rescore$).*)');
    assert.ok(re.test('/api/houses'));
    assert.ok(re.test('/api/rescore-later'));
    assert.ok(!re.test('/api/rescore'));
    assert.ok(vercel.rewrites.some((r) => r.source === '/healthz' && r.destination === '/api'));
  });

  test('the nightly cron calls the rescore function, which ships the engine', () => {
    assert.deepEqual(vercel.crons.map((c) => c.path), ['/api/rescore']);
    assert.equal(vercel.functions['api/rescore.py'].includeFiles, 'rating_engine/**');
  });
});
