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
function authMiddleware(req, res, next) {
  const apiKeyHeader = req.header('x-api-key') || req.header('X-API-Key');
  const expectedApiKey = process.env.API_KEY;

  if (!apiKeyHeader || !expectedApiKey || apiKeyHeader !== expectedApiKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  next();
}

module.exports = authMiddleware;
