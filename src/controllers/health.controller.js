/**
 * Health check controller
 * GET /health -> { "ok": true }
 */
function getHealth(req, res) {
  res.status(200).json({ ok: true });
}

module.exports = {
  getHealth,
};
