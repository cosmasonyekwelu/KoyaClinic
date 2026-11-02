const crypto = require('crypto');

/**
 * Normalizes booking payload for consistent hashing:
 * - Trims strings (e.g. name, slot_id, email).
 * - Normalizes email to lowercase.
 *
 * @param {any} body
 * @returns {any}
 */
function normalizeBookingBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }

  const normalized = {};
  for (const [key, val] of Object.entries(body)) {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (key === 'email') {
        normalized[key] = trimmed.toLowerCase();
      } else {
        normalized[key] = trimmed;
      }
    } else {
      normalized[key] = val;
    }
  }

  return normalized;
}

/**
 * Stable JSON serialization with sorted object keys.
 * Handles nested objects, arrays, and primitives.
 *
 * @param {any} obj
 * @returns {string}
 */
function stableSerialize(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(stableSerialize).join(',') + ']';
  }

  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableSerialize(obj[k])).join(',') + '}';
}

/**
 * Calculates SHA-256 hash of the normalized request body using stable JSON serialization.
 *
 * @param {any} body
 * @returns {string} Hex-encoded SHA-256 hash
 */
function calculateRequestHash(body) {
  const normalized = normalizeBookingBody(body);
  const serialized = stableSerialize(normalized);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

module.exports = {
  normalizeBookingBody,
  stableSerialize,
  calculateRequestHash,
};
