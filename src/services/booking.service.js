const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../db');
const { calculateRequestHash } = require('../utils/idempotency.util');

/**
 * Creates a booking for a slot.
 * Supports optional Idempotency-Key header processing (Level 4):
 * - If idempotencyKey is present:
 *   - SHA-256 hash of normalized request body
 *   - Uses PostgreSQL transaction with advisory lock (pg_advisory_xact_lock) for concurrency safety
 *   - If key exists with different hash, returns HTTP 422: {"error":"idempotency key reused with a different body"}
 *   - If key exists with same hash, replays original status and response body
 *   - Stores successful 201 responses and applicable 4xx responses (400, 404, 409)
 *   - Never creates duplicate bookings on replay
 * - If no idempotencyKey, processes normal booking creation.
 *
 * @param {{ slot_id: string, name: string, email: string, idempotencyKey?: string, rawBody?: any }} param0
 */
async function createBooking({ slot_id, name, email, idempotencyKey, rawBody }) {
  // If no idempotency key was provided, run standard booking transaction
  if (!idempotencyKey) {
    return await executeStandardBooking({ slot_id, name, email });
  }

  // Idempotent execution
  const requestHash = calculateRequestHash(rawBody || { slot_id, name, email });

  return await prisma.$transaction(async (tx) => {
    // 1. Acquire PostgreSQL advisory xact lock for the idempotency key to serialize concurrent requests with the same key
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`;

    // 2. Check if the idempotency key already exists
    const existing = await tx.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        const error = new Error('idempotency key reused with a different body');
        error.statusCode = 422;
        throw error;
      }

      // Replay original response
      return {
        isIdempotentReplay: true,
        statusCode: existing.statusCode,
        body: existing.responseBody,
      };
    }

    // 3. Key does not exist: execute booking attempt
    let statusCode = 201;
    let responseBody = null;

    try {
      const result = await processBookingCreation(tx, { slot_id, name, email });
      statusCode = 201;
      responseBody = result;
    } catch (bookingError) {
      let errStatus = bookingError.statusCode;
      let errMsg = bookingError.message;

      // Handle concurrency conflict or unique constraint violation
      if (
        (bookingError instanceof Prisma.PrismaClientKnownRequestError && bookingError.code === 'P2002') ||
        (errMsg && (errMsg.includes('one_confirmed_booking_per_slot') || errMsg.includes('unique constraint')))
      ) {
        errStatus = 409;
        errMsg = 'slot already booked';
      }

      // Applicable 4xx errors (400, 404, 409) are saved
      if (errStatus && [400, 404, 409].includes(errStatus)) {
        statusCode = errStatus;
        responseBody = { error: errMsg };
      } else {
        // Unexpected or unhandled 5xx error: rethrow so transaction rolls back and key is NOT saved
        throw bookingError;
      }
    }

    // 4. Save idempotency record in PostgreSQL
    await tx.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        requestHash,
        statusCode,
        responseBody,
      },
    });

    return {
      statusCode,
      body: responseBody,
    };
  });
}

/**
 * Standard non-idempotent booking creation.
 */
async function executeStandardBooking({ slot_id, name, email }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const booking = await processBookingCreation(tx, { slot_id, name, email });
      return {
        statusCode: 201,
        body: booking,
      };
    });
  } catch (error) {
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
 * Core booking verification and insertion logic inside a transaction.
 */
async function processBookingCreation(tx, { slot_id, name, email }) {
  // 1. Verify slot exists
  const slot = await tx.slot.findUnique({
    where: { id: slot_id },
  });

  if (!slot) {
    const error = new Error('slot not found');
    error.statusCode = 404;
    throw error;
  }

  // 2. Verify slot has not already started or is in the past
  const now = new Date();
  if (new Date(slot.start).getTime() <= now.getTime()) {
    const error = new Error('slot already started');
    error.statusCode = 400;
    throw error;
  }

  // 3. Verify slot does not already have an active confirmed booking
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
}

/**
 * Saves an applicable 4xx error (e.g. 400 validation error) with an idempotency key.
 */
async function recordIdempotentError(idempotencyKey, rawBody, statusCode, errorMessage) {
  if (!idempotencyKey || ![400, 404, 409].includes(statusCode)) {
    return;
  }

  const requestHash = calculateRequestHash(rawBody);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`;

      const existing = await tx.idempotencyKey.findUnique({
        where: { key: idempotencyKey },
      });

      if (!existing) {
        await tx.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            requestHash,
            statusCode,
            responseBody: { error: errorMessage },
          },
        });
      }
    });
  } catch (err) {
    // Best effort, do not crash on recording failure
  }
}

/**
 * Checks if an idempotency key exists prior to processing.
 * If key exists with different hash: throws 422.
 * If key exists with same hash: returns { statusCode, body }.
 * If key does not exist: returns null.
 */
async function checkExistingIdempotencyKey(idempotencyKey, rawBody) {
  if (!idempotencyKey) {
    return null;
  }

  const requestHash = calculateRequestHash(rawBody);

  const existing = await prisma.idempotencyKey.findUnique({
    where: { key: idempotencyKey },
  });

  if (!existing) {
    return null;
  }

  if (existing.requestHash !== requestHash) {
    const error = new Error('idempotency key reused with a different body');
    error.statusCode = 422;
    throw error;
  }

  return {
    statusCode: existing.statusCode,
    body: existing.responseBody,
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
    // Check if the booking exists at all, including slot details for start time check
    const booking = await tx.booking.findUnique({
      where: { id },
      include: {
        slot: true,
      },
    });

    if (!booking) {
      const error = new Error('booking not found');
      error.statusCode = 404;
      throw error;
    }

    if (booking.status === 'cancelled') {
      const error = new Error('booking already cancelled');
      error.statusCode = 409;
      throw error;
    }

    // Prevent cancellation of appointments that have already passed
    if (booking.slot && new Date(booking.slot.start).getTime() <= Date.now()) {
      const error = new Error('cannot cancel past appointment');
      error.statusCode = 400;
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
  recordIdempotentError,
  checkExistingIdempotencyKey,
};

const { encodeCursor, decodeCursor } = require('../utils/pagination.util');

/**
 * Lists a person's bookings with keyset pagination.
 *
 * Requirements (Level 4):
 * - email: required, case-insensitive match, trimmed and lowercased.
 * - limit: integer between 1 and 50, default 10.
 * - cursor: optional, base64url encoded created_at and id.
 * - Returns confirmed and cancelled bookings.
 * - Sort oldest first using created_at ASC, id ASC.
 * - Keyset/cursor pagination.
 * - next_cursor: null on final page.
 *
 * @param {{ email: string, limit?: number, cursor?: string }} params
 */
async function listBookings({ email, limit = 10, cursor }) {
  if (!email || typeof email !== 'string' || !email.trim()) {
    const error = new Error('email is required');
    error.statusCode = 400;
    throw error;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const where = {
    email: {
      equals: normalizedEmail,
      mode: 'insensitive',
    },
  };

  if (cursor) {
    const cursorInfo = decodeCursor(cursor);
    where.OR = [
      {
        created_at: {
          gt: cursorInfo.createdAt,
        },
      },
      {
        created_at: cursorInfo.createdAt,
        id: {
          gt: cursorInfo.id,
        },
      },
    ];
  }

  // Fetch limit + 1 records to determine if there is a subsequent page
  const records = await prisma.booking.findMany({
    where,
    orderBy: [
      { created_at: 'asc' },
      { id: 'asc' },
    ],
    take: limit + 1,
  });

  const hasMore = records.length > limit;
  const pageItems = hasMore ? records.slice(0, limit) : records;

  let next_cursor = null;
  if (hasMore && pageItems.length > 0) {
    const lastItem = pageItems[pageItems.length - 1];
    next_cursor = encodeCursor({
      created_at: lastItem.created_at,
      id: lastItem.id,
    });
  }

  const bookings = pageItems.map((b) => ({
    id: b.id,
    slot_id: b.slot_id,
    name: b.name,
    email: b.email,
    status: b.status,
    created_at: b.created_at.toISOString(),
  }));

  return {
    bookings,
    next_cursor,
  };
}

module.exports.listBookings = listBookings;
