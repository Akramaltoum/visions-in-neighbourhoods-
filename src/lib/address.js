'use strict';

// Same rules as rating_engine/research.py normalise_address, so the website and the
// rating engine agree on when two spellings are the same house.
const SUFFIXES = {
  street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', crescent: 'cres',
  boulevard: 'blvd', court: 'ct', place: 'pl', lane: 'ln',
};
const PLACE_WORDS = new Set(['hamilton', 'on', 'ontario', 'canada']);

function addressKey(address) {
  const cleaned = String(address).toLowerCase().replace(/\b[a-z]\d[a-z]\s?\d[a-z]\d\b/g, ' ');
  const words = cleaned.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => SUFFIXES[w] || w);
  while (words.length && PLACE_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

module.exports = { addressKey };
