const bookingService = require('../services/booking.service');

/**
 * POST /bookings
 * Create a new booking for a slot.
 */
async function createBooking(req, res, next) {
  try {
    const { slot_id, name, email } = req.body || {};
    const booking = await bookingService.createBooking({ slot_id, name, email });
    res.status(201).json(booking);
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

module.exports = {
  createBooking,
  getBookingById,
};
