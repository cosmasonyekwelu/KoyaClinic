const prisma = require('../db');

/**
 * POST /reset
 * Deletes existing bookings, deletes existing slots, and inserts the supplied slots inside a database transaction.
 * Accepts past slots.
 * Returns HTTP 200.
 */
async function resetDatabase(req, res, next) {
  try {
    const slots = req.body && Array.isArray(req.body.slots) ? req.body.slots : [];

    await prisma.$transaction(async (tx) => {
      await tx.booking.deleteMany();
      await tx.slot.deleteMany();

      if (slots.length > 0) {
        await tx.slot.createMany({
          data: slots.map((slot) => ({
            id: slot.id,
            provider: slot.provider,
            start: new Date(slot.start),
            end: new Date(slot.end),
          })),
        });
      }
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  resetDatabase,
};
