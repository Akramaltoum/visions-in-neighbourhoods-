'use strict';

// The ranking half of the spec, in JavaScript because it runs per visitor with their
// own sliders. The scores themselves come from the Python engine (api/rescore.py).
// Keep in step with rating_engine/ranking.py.
const DEFAULT_SLIDERS = { commute: 3, food: 3, social: 3, inside: 3, value: 3 };
const HIGH = 0.75;
const MEDIUM = 0.45;

function level(c) {
  if (c >= HIGH) return 'High';
  if (c >= MEDIUM) return 'Medium';
  return 'Low';
}

// Low scores are shown as value +/- 3 x (1 - c).
function displayRange(value, c) {
  if (level(c) !== 'Low') return null;
  const half = 3 * (1 - c);
  return [Math.max(0, value - half), Math.min(10, value + half)];
}

function used(scores, sliders) {
  return Object.entries(sliders).filter(([name, p]) => p > 0 && scores[name]);
}

// Overall = sum(p x Score) / sum(p), over the scores this house has.
function overall(scores, sliders) {
  const u = used(scores, sliders);
  const total = u.reduce((a, [, p]) => a + p, 0);
  return total ? u.reduce((a, [name, p]) => a + p * scores[name].value, 0) / total : 0;
}

function averageConfidence(scores, sliders) {
  const u = used(scores, sliders);
  const total = u.reduce((a, [, p]) => a + p, 0);
  return total ? u.reduce((a, [name, p]) => a + p * scores[name].confidence, 0) / total : 0;
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Rank = c x Overall + (1 - c) x neighbourhood median, so a guess can't outrank a
// well-reviewed house. Houses with no scores at all sort last.
function rank(houses, sliders = DEFAULT_SLIDERS) {
  for (const h of houses) {
    h.overall = overall(h.scores, sliders);
    h.avgConfidence = averageConfidence(h.scores, sliders);
  }
  const medians = {};
  for (const n of new Set(houses.map((h) => h.neighbourhood))) {
    medians[n] = median(houses.filter((h) => h.neighbourhood === n && Object.keys(h.scores).length).map((h) => h.overall));
  }
  for (const h of houses) {
    h.rankKey = Object.keys(h.scores).length ? h.avgConfidence * h.overall + (1 - h.avgConfidence) * medians[h.neighbourhood] : -1;
  }
  return houses.sort((a, b) => (Math.round(b.rankKey * 100) - Math.round(a.rankKey * 100)) || (b.avgConfidence - a.avgConfidence));
}

function parseSliders(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SLIDERS };
  const out = {};
  for (const name of Object.keys(DEFAULT_SLIDERS)) {
    const v = Number(raw[name]);
    out[name] = Number.isInteger(v) && v >= 0 && v <= 5 ? v : DEFAULT_SLIDERS[name];
  }
  return out;
}

module.exports = { DEFAULT_SLIDERS, level, displayRange, overall, averageConfidence, rank, parseSliders };
