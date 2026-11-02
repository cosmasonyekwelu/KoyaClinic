const bookingService = require('../services/booking.service');

/**
 * POST /bookings
 * Create a new booking for a slot.
 * Supports Level 4 Idempotency-Key.
 */
async function createBooking(req, res, next) {
  try {
    const { slot_id, name, email } = req.body || {};
    const idempotencyKey = req.idempotencyKey || req.header('idempotency-key') || req.header('Idempotency-Key');
    const rawBody = req.rawBody || req.body;

    const result = await bookingService.createBooking({
      slot_id,
      name,
      email,
      idempotencyKey,
      rawBody,
    });

    res.status(result.statusCode).json(result.body);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /bookings/:id
 * Retrieve a booking by its ID.
 */
async function getBookingById(req, res, next) {
  try {
    const { id } = req.params;
    const booking = await bookingService.getBookingById(id);
    res.status(200).json(booking);
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /bookings/:id
 * Cancel a booking by its ID.
 */
async function cancelBooking(req, res, next) {
  try {
    const { id } = req.params;
    const booking = await bookingService.cancelBooking(id);
    res.status(200).json(booking);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createBooking,
  getBookingById,
  cancelBooking,
};

/**
 * GET /bookings
 * Lists a person's bookings with pagination.
 */
async function listBookings(req, res, next) {
  try {
    const { email, cursor } = req.query;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }

    let limit = 10;
    if (req.query.limit !== undefined) {
      const rawLimit = String(req.query.limit).trim();
      if (!/^\d+$/.test(rawLimit)) {
        return res.status(400).json({ error: 'invalid limit' });
      }
      const parsedLimit = parseInt(rawLimit, 10);
      if (parsedLimit < 1 || parsedLimit > 50) {
        return res.status(400).json({ error: 'invalid limit' });
      }
      limit = parsedLimit;
    }

    const result = await bookingService.listBookings({
      email,
      limit,
      cursor,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports.listBookings = listBookings;
