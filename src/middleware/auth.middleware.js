/**
 * Express middleware for X-API-Key header authentication.
 *
 * Requirements (Level 2):
 * - Every API request must include `X-API-Key: YOUR_API_KEY`
 * - Missing API key: HTTP 401
 * - Invalid API key: HTTP 401
 * - Valid API key: allow access
 * - Error response: {"error":"unauthorized"}
 * - Store the key in process.env.API_KEY
 * - Never hardcode secrets
 */
const crypto = require('crypto');

function authMiddleware(req, res, next) {
  // req.get is case-insensitive in Express
  const apiKeyHeader = req.get('x-api-key');
  const expectedApiKey = process.env.API_KEY;

  if (
    !apiKeyHeader ||
    typeof apiKeyHeader !== 'string' ||
    apiKeyHeader.trim() === '' ||
    !expectedApiKey
  ) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const providedBuf = Buffer.from(apiKeyHeader);
  const expectedBuf = Buffer.from(expectedApiKey);

  // Timing-safe comparison guarding length differences
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  next();
}

module.exports = authMiddleware;
