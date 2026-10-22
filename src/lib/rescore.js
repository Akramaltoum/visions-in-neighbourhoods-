'use strict';

// Asks the Python rating engine (api/rescore.py) to recompute one house's scores.
// It waits a few seconds at most: if the engine is slow, the nightly cron run
// catches the house up, so a failure here never blocks the person's request.
function createRescorer(config, { fetchImpl = globalThis.fetch } = {}) {
  if (!config.cronSecret || !config.publicBaseUrl.startsWith('https://')) {
    return async () => false;
  }
  return async (houseId) => {
    try {
      const res = await fetchImpl(`${config.publicBaseUrl}/api/rescore`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.cronSecret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ houseId }),
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch (err) {
      console.error('Rescore request failed:', err.message);
      return false;
    }
  };
}

module.exports = { createRescorer };
