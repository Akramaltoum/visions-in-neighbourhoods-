'use strict';

const { badRequest } = require('./http');

const MAX_PROOF_BYTES = 3 * 1024 * 1024;
const MAGIC = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
};

// A lease page, rent receipt or ownership proof sent as { mime, data (base64) }.
// Checked by a person, then the file is deleted (see routes/admin.js).
function parseProof(raw) {
  if (!raw || typeof raw !== 'object') throw badRequest('Attach a lease page or rent receipt', 'proof_required');
  const check = MAGIC[raw.mime];
  if (!check || typeof raw.data !== 'string') throw badRequest('Proof must be a JPEG, PNG or PDF', 'invalid_proof');
  const data = Buffer.from(raw.data, 'base64');
  if (!data.length || data.length > MAX_PROOF_BYTES) throw badRequest('Proof must be under 3 MB', 'invalid_proof');
  if (!check(data)) throw badRequest("That file doesn't look like the type it says it is", 'invalid_proof');
  return { mime: raw.mime, data };
}

module.exports = { parseProof, MAX_PROOF_BYTES };
