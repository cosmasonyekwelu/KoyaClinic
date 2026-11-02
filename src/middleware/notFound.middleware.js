/**
 * JSON 404 Not Found handler
 * Matches the OpenAPI error schema: { "error": "<message>" }
 */
function notFoundHandler(req, res, next) {
  res.status(404).json({ error: 'Route not found' });
}

module.exports = notFoundHandler;
