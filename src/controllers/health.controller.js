/**
 * Health check controller
 * GET /health -> { "ok": true }
 */
const prisma = require('../db');

/**
 * Health check controller
 * GET /health -> { "ok": true, "db": "up" | "down" }
 * Public endpoint used for warm-up pings and readiness probes.
 */
async function getHealth(req, res) {
  let dbStatus = 'down';
  try {
    // Ping database with lightweight query
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'up';
  } catch (err) {
    dbStatus = 'down';
  }

  // Always return ok: true for service health / warm-up, and report db status
  res.status(200).json({
    ok: true,
    db: dbStatus,
  });
}

module.exports = {
  getHealth,
};
