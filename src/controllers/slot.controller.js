const slotService = require('../services/slot.service');

/**
 * POST /reset
 * Replace all slots and delete all bookings.
 */
async function reset(req, res, next) {
  try {
    const { slots } = req.body || {};
    await slotService.resetSlots(slots || []);
    res.status(200).send();
  } catch (error) {
    next(error);
  }
}

/**
 * GET /slots
 * List slots ordered by start ASC, with optional provider query param.
 */
async function getSlots(req, res, next) {
  try {
    const { provider } = req.query;
    const slots = await slotService.getSlots({ provider });
    res.status(200).json({ slots });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  reset,
  getSlots,
};
