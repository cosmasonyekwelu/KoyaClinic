const prisma = require('../db');

/**
 * POST /bookings
 * Checks that the slot exists.
 * Creates a confirmed booking with generated unique ID and current created_at.
 * Returns HTTP 201 with booking.
 * If slot not found, returns HTTP 404 with { "error": "slot not found" }.
 */
async function createBooking(req, res, next) {
  try {
    const { slot_id, name, email } = req.body || {};

    const slot = await prisma.slot.findUnique({
      where: { id: slot_id },
    });

    if (!slot) {
      return res.status(404).json({ error: 'slot not found' });
    }

    const booking = await prisma.booking.create({
      data: {
        slot_id,
        name,
        email,
        status: 'confirmed',
      },
    });

    return res.status(201).json({
      id: booking.id,
      slot_id: booking.slot_id,
      name: booking.name,
      email: booking.email,
      status: booking.status,
      created_at: booking.created_at.toISOString(),
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /bookings/:id
 * Retrieves a booking by its ID (including cancelled bookings).
 * Returns HTTP 200 with booking.
 * Returns HTTP 404 with { "error": "booking not found" } if missing.
 */
async function getBookingById(req, res, next) {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      return res.status(404).json({ error: 'booking not found' });
    }

    return res.status(200).json({
      id: booking.id,
      slot_id: booking.slot_id,
      name: booking.name,
      email: booking.email,
      status: booking.status,
      created_at: booking.created_at.toISOString(),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createBooking,
  getBookingById,
};
