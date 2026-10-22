'use strict';

// Vercel serverless function: every /api/* request except /api/rescore is rewritten here (vercel.json).
module.exports = require('../src/handler');
