'use strict';

/**
 * fetch avec timeout. Une erreur réseau ou un dépassement de délai est
 * remontée sous la forme d'une erreur `network` que l'appelant traduit.
 */
async function timedFetch(fetchImpl, url, options, timeoutMs) {
  try {
    return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    const error = new Error(`Network failure calling ${url}`, { cause });
    error.network = true;
    throw error;
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = { timedFetch, readJson };
