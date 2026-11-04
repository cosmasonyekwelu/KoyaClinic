const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/db');
const {
  DOCTOR_SCHEDULES,
  generateSlotsForDoctorOnDate,
  generateUpcomingSlots,
} = require('../src/utils/schedule.util');
const { seed } = require('../scripts/seed');

const API_KEY = process.env.API_KEY || 'test-api-key';

describe('Clinic Availability & Scheduling System', () => {
  // Use future dates for slots so they pass the `slot.start > now` validation
  const FUTURE_YEAR = 2028;
  const slotDate1 = `${FUTURE_YEAR}-10-01T08:00:00.000Z`;
  const slotDate1End = `${FUTURE_YEAR}-10-01T08:30:00.000Z`;
  const slotDate2 = `${FUTURE_YEAR}-10-01T09:00:00.000Z`;
  const slotDate2End = `${FUTURE_YEAR}-10-01T09:30:00.000Z`;
  const slotDate3 = `${FUTURE_YEAR}-10-01T10:00:00.000Z`;
  const slotDate3End = `${FUTURE_YEAR}-10-01T10:30:00.000Z`;

  beforeEach(async () => {
    // Reset database with clean test slots before each test
    await request(app)
      .post('/reset')
      .set('X-API-Key', API_KEY)
      .send({
        slots: [
          {
            id: 'test-slot-1',
            provider: 'Dr Adebayo Olufemi',
            start: slotDate1,
            end: slotDate1End,
          },
          {
            id: 'test-slot-2',
            provider: 'Dr Chioma Nwosu',
            start: slotDate2,
            end: slotDate2End,
          },
          {
            id: 'test-slot-3',
            provider: 'Dr Folake Adeleke',
            start: slotDate3,
            end: slotDate3End,
          },
        ],
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Schedule Generator & Timezone Handling', () => {
    it('should define at least 3 doctors with distinct working days and hours', () => {
      expect(DOCTOR_SCHEDULES.length).toBeGreaterThanOrEqual(3);

      const names = DOCTOR_SCHEDULES.map((d) => d.name);
      expect(names).toContain('Dr Adebayo Olufemi');
      expect(names).toContain('Dr Chioma Nwosu');
      expect(names).toContain('Dr Folake Adeleke');
    });

    it('should generate 30-minute slots strictly aligned with Africa/Lagos (UTC+1)', () => {
      const doctor = DOCTOR_SCHEDULES[0]; // Adebayo: Mon-Fri 09:00 - 13:00 WAT
      // 2028-10-02 is a Monday
      const slots = generateSlotsForDoctorOnDate(doctor, 2028, 10, 2, 30);

      // 09:00 to 13:00 WAT is 4 hours = 8 slots of 30 mins
      expect(slots.length).toBe(8);

      // In UTC, 09:00 WAT is 08:00 UTC
      expect(slots[0].start).toBe('2028-10-02T08:00:00.000Z');
      expect(slots[0].end).toBe('2028-10-02T08:30:00.000Z');
      expect(slots[slots.length - 1].start).toBe('2028-10-02T11:30:00.000Z');
      expect(slots[slots.length - 1].end).toBe('2028-10-02T12:00:00.000Z');
    });

    it('should support configurable slot durations (e.g., 60 minutes)', () => {
      const doctor = DOCTOR_SCHEDULES[0]; // Adebayo: 4 hours
      const slots60 = generateSlotsForDoctorOnDate(doctor, 2028, 10, 2, 60);

      // 4 hours with 60 min slots = 4 slots
      expect(slots60.length).toBe(4);
      expect(slots60[0].start).toBe('2028-10-02T08:00:00.000Z');
      expect(slots60[0].end).toBe('2028-10-02T09:00:00.000Z');
    });

    it('should not generate slots on non-working days', () => {
      const doctor = DOCTOR_SCHEDULES[0]; // Adebayo: Mon-Fri
      // 2028-10-08 is a Sunday
      const slots = generateSlotsForDoctorOnDate(doctor, 2028, 10, 8, 30);
      expect(slots.length).toBe(0);
    });

    it('should generate slots across multiple doctors for upcoming days', () => {
      const allSlots = generateUpcomingSlots({
        daysAhead: 7,
        slotDurationMinutes: 30,
        startDate: new Date('2028-10-01T00:00:00.000Z'),
      });
      expect(allSlots.length).toBeGreaterThan(50);

      const providers = new Set(allSlots.map((s) => s.provider));
      expect(providers.size).toBe(3);
    });
  });

  describe('2. Safe & Idempotent Seeding', () => {
    it('should idempotently seed slots without creating fake bookings', async () => {
      const seeded1 = await seed({ force: true, silent: true });
      expect(seeded1.total).toBeGreaterThan(0);

      // Run seeding again - should be safe and idempotent
      const seeded2 = await seed({ force: true, silent: true });
      expect(seeded2.total).toBe(seeded1.total);

      // Ensure NO bookings exist from seed
      const allBookings = await prisma.booking.findMany();
      expect(allBookings).toHaveLength(0);
    });
  });

  describe('3. Multi-Doctor Provider Filtering and Availability', () => {
    it('should filter slots by provider using official GET /slots?provider=', async () => {
      const res = await request(app)
        .get('/slots?provider=Dr+Chioma+Nwosu')
        .set('X-API-Key', API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.slots.length).toBeGreaterThanOrEqual(1);
      const match = res.body.slots.find((s) => s.id === 'test-slot-2');
      expect(match).toBeDefined();
      expect(match.provider).toBe('Dr Chioma Nwosu');
      expect(match.available).toBe(true);
    });

    it('should return available=false once a slot is booked', async () => {
      // 1. Initial status: available
      let res = await request(app)
        .get('/slots?provider=Dr+Adebayo+Olufemi')
        .set('X-API-Key', API_KEY);
      expect(res.status).toBe(200);
      let s1 = res.body.slots.find((s) => s.id === 'test-slot-1');
      expect(s1.available).toBe(true);

      // 2. Book the slot
      const bookRes = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'test-slot-1',
          name: 'Tunde Bakare',
          email: 'tunde@example.com',
        });
      expect(bookRes.status).toBe(201);

      // 3. Status is now available=false
      res = await request(app)
        .get('/slots?provider=Dr+Adebayo+Olufemi')
        .set('X-API-Key', API_KEY);
      expect(res.status).toBe(200);
      s1 = res.body.slots.find((s) => s.id === 'test-slot-1');
      expect(s1.available).toBe(false);
    });
  });

  describe('4. Concurrency Protection & PostgreSQL Uniqueness', () => {
    it('should protect against concurrent bookings on the same slot', async () => {
      const concurrentRequests = 10;
      const requests = Array.from({ length: concurrentRequests }, (_, i) =>
        request(app)
          .post('/bookings')
          .set('X-API-Key', API_KEY)
          .send({
            slot_id: 'test-slot-2',
            name: `Patient ${i}`,
            email: `patient${i}@example.com`,
          })
      );

      const results = await Promise.all(requests);
      const successes = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(concurrentRequests - 1);

      for (const conflict of conflicts) {
        expect(conflict.body).toEqual({ error: 'slot already booked' });
      }

      // Verify PostgreSQL partial unique index enforced exactly 1 confirmed booking
      const confirmed = await prisma.booking.findMany({
        where: { slot_id: 'test-slot-2', status: 'confirmed' },
      });
      expect(confirmed).toHaveLength(1);
    });
  });

  describe('5. Cancellation and Slot Restoration', () => {
    it('should restore slot availability upon cancellation and allow new booking', async () => {
      // 1. Book test-slot-3
      const bookRes = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'test-slot-3',
          name: 'Ngozi Okonjo',
          email: 'ngozi@example.com',
        });
      expect(bookRes.status).toBe(201);
      const bookingId = bookRes.body.id;

      // 2. Verify slot is unavailable
      let slotsRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
      let slot3 = slotsRes.body.slots.find((s) => s.id === 'test-slot-3');
      expect(slot3.available).toBe(false);

      // 3. Cancel booking
      const cancelRes = await request(app)
        .delete(`/bookings/${bookingId}`)
        .set('X-API-Key', API_KEY);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('cancelled');

      // 4. Verify slot is available again
      slotsRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
      slot3 = slotsRes.body.slots.find((s) => s.id === 'test-slot-3');
      expect(slot3.available).toBe(true);

      // 5. Another patient books the restored slot
      const rebookRes = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'test-slot-3',
          name: 'Emeka Anyaoku',
          email: 'emeka@example.com',
        });
      expect(rebookRes.status).toBe(201);
    });
  });
});
