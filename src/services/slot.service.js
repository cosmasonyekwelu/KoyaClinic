const prisma = require('../db');

/**
 * Resets slots and bookings inside a database transaction.
 * Also clears idempotency keys to ensure clean test state.
 * @param {Array<{ id: string, provider: string, start: string, end: string }>} slots
 */
async function resetSlots(slots = []) {
  return await prisma.$transaction(async (tx) => {
    // Delete existing idempotency keys
    await tx.idempotencyKey.deleteMany();
    // Delete existing bookings first (though cascade is enabled on slots, deleting explicitly is clean)
    await tx.booking.deleteMany();
    // Delete existing slots
    await tx.slot.deleteMany();

    // Insert supplied slots
    if (slots && slots.length > 0) {
      const slotData = slots.map((s) => ({
        id: s.id,
        provider: s.provider,
        start: new Date(s.start),
        end: new Date(s.end),
      }));

      await tx.slot.createMany({
        data: slotData,
      });
    }
  });
}

/**
 * Lists all slots ordered by start ASC, optionally filtered by provider (exact match).
 * Calculates available boolean: false if there is any confirmed booking for that slot.
 * Returns ISO-8601 UTC strings for dates.
 * @param {{ provider?: string }} filters
 */
async function getSlots(filters = {}) {
  const where = {};
  if (filters.provider !== undefined) {
    where.provider = filters.provider;
  }

  // Filter out past appointment slots unless explicitly requested to include them
  // e.g., filters.include_past === 'true' or true
  const includePast = filters.include_past === true || filters.include_past === 'true';
  if (!includePast) {
    where.start = {
      gt: new Date(),
    };
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

  return slots.map((slot) => ({
    id: slot.id,
    provider: slot.provider,
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
    available: slot.bookings.length === 0,
  }));
}

module.exports = {
  resetSlots,
  getSlots,
};
