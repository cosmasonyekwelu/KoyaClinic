const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../db');

/**
 * Creates a booking for a slot.
 *
 * Level 1 & 2 Requirements:
 * - Check that the slot exists. If missing, return HTTP 404: {"error":"slot not found"}
 * - If the slot has already started or is in the past, return HTTP 400: {"error":"slot already started"}
 * - Create a confirmed booking with UUID id
 * - Never create a booking when validation fails
 *
 * Level 3 Requirements:
 * - Prevent double booking: guarantee only one confirmed booking can exist for an appointment slot.
 * - Works even when multiple patients submit booking requests simultaneously.
 * - Atomic database operations / PostgreSQL transactions.
 * - Database partial unique index: one_confirmed_booking_per_slot ON "bookings"("slot_id") WHERE status = 'confirmed'.
 * - If slot already booked or competing request attempts to book, return HTTP 409: {"error":"slot already booked"}.
 *
 * @param {{ slot_id: string, name: string, email: string }} param0
 */
async function createBooking({ slot_id, name, email }) {
  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Verify slot exists
      const slot = await tx.slot.findUnique({
        where: { id: slot_id },
      });

      if (!slot) {
        const error = new Error('slot not found');
        error.statusCode = 404;
        throw error;
      }

      // 2. Verify slot has not already started or is in past
      const now = new Date();
      if (new Date(slot.start).getTime() <= now.getTime()) {
        const error = new Error('slot already started');
        error.statusCode = 400;
        throw error;
      }

      // 3. Pre-check: check if an active confirmed booking already exists for this slot
      const existingConfirmed = await tx.booking.findFirst({
        where: {
          slot_id,
          status: 'confirmed',
        },
      });

      if (existingConfirmed) {
        const error = new Error('slot already booked');
        error.statusCode = 409;
        throw error;
      }

      // 4. Create the booking atomically
      const bookingId = crypto.randomUUID();
      const booking = await tx.booking.create({
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
    });
  } catch (error) {
    // Handle Prisma unique constraint violation (code P2002) or raw postgres 23505
    if (
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
      (error.message && (error.message.includes('one_confirmed_booking_per_slot') || error.message.includes('unique constraint')))
    ) {
      const conflictError = new Error('slot already booked');
      conflictError.statusCode = 409;
      throw conflictError;
    }

    throw error;
  }
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

/**
 * Cancels a booking atomically.
 *
 * Level 3 Requirements:
 * - Find the booking.
 * - Return 404 if the booking does not exist.
 * - Return 409 if already cancelled.
 * - Change status from confirmed to cancelled.
 * - Do not delete the booking record.
 * - Free the slot for future bookings.
 * - Return the full cancelled booking object.
 *
 * @param {string} id
 */
async function cancelBooking(id) {
  return await prisma.$transaction(async (tx) => {
    // Check if the booking exists at all
    const booking = await tx.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      const error = new Error('booking not found');
      error.statusCode = 404;
      throw error;
    }

    // Atomic conditional update: update ONLY IF current status is 'confirmed'
    const updateResult = await tx.booking.updateMany({
      where: {
        id,
        status: 'confirmed',
      },
      data: {
        status: 'cancelled',
      },
    });

    if (updateResult.count === 0) {
      const error = new Error('booking already cancelled');
      error.statusCode = 409;
      throw error;
    }

    // Return the updated booking object
    const updated = await tx.booking.findUnique({
      where: { id },
    });

    return {
      id: updated.id,
      slot_id: updated.slot_id,
      name: updated.name,
      email: updated.email,
      status: updated.status,
      created_at: updated.created_at.toISOString(),
    };
  });
}

module.exports = {
  createBooking,
  getBookingById,
  cancelBooking,
};
