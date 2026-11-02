const prisma = require('../db');

/**
 * GET /slots
 * Returns slots sorted by start time ascending.
 * Supports optional provider query parameter (exact matching).
 * Slot is unavailable if it has a confirmed booking.
 * Returns ISO-8601 UTC dates.
 */
async function getSlots(req, res, next) {
  try {
    const { provider } = req.query;

    const where = {};
    if (provider !== undefined) {
      where.provider = provider;
    }

    const slots = await prisma.slot.findMany({
      where,
      orderBy: {
        start: 'asc',
      },
      include: {
        bookings: {
          where: {
            status: 'confirmed',
          },
          select: {
            id: true,
          },
        },
      },
    });

    const formattedSlots = slots.map((slot) => ({
      id: slot.id,
      provider: slot.provider,
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      available: slot.bookings.length === 0,
    }));

    return res.status(200).json({ slots: formattedSlots });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getSlots,
};
