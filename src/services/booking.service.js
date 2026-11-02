const crypto = require('crypto');
const prisma = require('../db');

/**
 * Creates a booking for a slot.
 * Level 1 Requirements:
 * - Check that the slot exists (throw 404 error if missing)
 * - Create a confirmed booking
 * - Generate a unique booking ID
 * - Save the booking in PostgreSQL
 * - Set created_at to current time
 * @param {{ slot_id: string, name: string, email: string }} param0
 */
async function createBooking({ slot_id, name, email }) {
  const slot = await prisma.slot.findUnique({
    where: { id: slot_id },
  });

  if (!slot) {
    const error = new Error('slot not found');
    error.statusCode = 404;
    throw error;
  }

  const bookingId = crypto.randomUUID();
  const now = new Date();

  const booking = await prisma.booking.create({
    data: {
      id: bookingId,
      slot_id,
      name,
      email,
      status: 'confirmed',
      created_at: now,
    },
  });

  return {
    id: booking.id,
    slot_id: booking.slot_id,
    name: booking.name,
    email: booking.email,
    status: booking.status,
    created_at: booking.created_at.toISOString(),
  };
}

/**
 * Retrieves a booking by its ID.
 * Returns HTTP 404 with {"error": "booking not found"} if missing.
 * Includes cancelled bookings when they exist.
 * @param {string} id
 */
async function getBookingById(id) {
  const booking = await prisma.booking.findUnique({
    where: { id },
  });

  if (!booking) {
    const error = new Error('booking not found');
    error.statusCode = 404;
    throw error;
  }

  return {
    id: booking.id,
    slot_id: booking.slot_id,
    name: booking.name,
    email: booking.email,
    status: booking.status,
    created_at: booking.created_at.toISOString(),
  };
}

module.exports = {
  createBooking,
  getBookingById,
};
