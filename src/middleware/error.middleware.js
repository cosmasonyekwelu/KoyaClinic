/**
 * Centralized error handling middleware.
 * Ensures all errors conform to the OpenAPI error contract: { "error": "<message>" }
 * Never leaks database connection strings, stack traces, or credentials to clients.
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[Error] ${statusCode} - ${message}`);
    if (statusCode === 500 && err.stack) {
      console.error(err.stack);
    }
  }

  // Sanitize potential sensitive error messages if uncaught 500
  const clientMessage = statusCode === 500 && process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : message;

  res.status(statusCode).json({ error: clientMessage });
}

module.exports = errorHandler;
