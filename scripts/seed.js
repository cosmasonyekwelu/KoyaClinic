#!/usr/bin/env node
/**
 * Safe & Repeatable (Idempotent) Clinic Seed Script
 *
 * Rules:
 * 1. Seeds appointment slots only (NEVER seeds fake patient bookings).
 * 2. Does NOT wipe or overwrite production database unless explicitly overridden with --force.
 * 3. Uses Prisma upsert so re-running multiple times is 100% idempotent and safe.
 * 4. Generates realistic schedules for multiple doctors across multiple upcoming dates in Africa/Lagos timezone.
 */

require('dotenv').config();
const prisma = require('../src/db');
const { generateUpcomingSlots, DOCTOR_SCHEDULES } = require('../src/utils/schedule.util');

async function seed(options = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const force = process.argv.includes('--force') || options.force;

  if (isProduction && !force) {
    console.error('SAFETY WARNING: Seeding is blocked in production environment.');
    console.error('If you really intend to seed production slots, rerun with --force flag.');
    if (!options.silent) {
      process.exit(1);
    }
    return { success: false, reason: 'blocked_in_production' };
  }

  const daysAhead = parseInt(process.env.SEED_DAYS_AHEAD || '14', 10);
  const slotDuration = parseInt(process.env.SEED_SLOT_DURATION_MINUTES || '30', 10);

  console.log('--- Starting Clinic Slot Seeding ---');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Config: ${daysAhead} days ahead, ${slotDuration} min duration`);
  console.log(`Doctors to seed: ${DOCTOR_SCHEDULES.map((d) => d.name).join(', ')}`);

  const slotsToSeed = generateUpcomingSlots({
    daysAhead,
    slotDurationMinutes: slotDuration,
  });

  console.log(`Generated ${slotsToSeed.length} slots. Upserting into PostgreSQL...`);

  let createdCount = 0;
  let updatedCount = 0;

  for (const slot of slotsToSeed) {
    const existing = await prisma.slot.findUnique({
      where: { id: slot.id },
    });

    await prisma.slot.upsert({
      where: { id: slot.id },
      update: {
        provider: slot.provider,
        start: new Date(slot.start),
        end: new Date(slot.end),
      },
      create: {
        id: slot.id,
        provider: slot.provider,
        start: new Date(slot.start),
        end: new Date(slot.end),
      },
    });

    if (existing) {
      updatedCount++;
    } else {
      createdCount++;
    }
  }

  console.log(`✓ Seeding complete: ${createdCount} created, ${updatedCount} verified/updated.`);
  console.log(`Total slots in database: ${await prisma.slot.count()}`);

  return {
    success: true,
    total: slotsToSeed.length,
    created: createdCount,
    updated: updatedCount,
  };
}

// Execute directly if invoked from command line
if (require.main === module) {
  seed()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seeding error:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

module.exports = { seed };
