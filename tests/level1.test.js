const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/db');

describe('Level 1 Clinic Booking API Tests', () => {
  beforeAll(async () => {
    // Ensure clean state
    await prisma.booking.deleteMany();
    await prisma.slot.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /reset', () => {
    it('should reset slots and bookings inside a transaction and accept past slots', async () => {
      const resetPayload = {
        slots: [
          {
            id: 's-past',
            provider: 'Dr Ade',
            start: '2020-01-01T09:00:00Z',
            end: '2020-01-01T09:30:00Z',
          },
          {
            id: 's-future',
            provider: 'Dr Bello',
            start: '2026-12-10T10:00:00Z',
            end: '2026-12-10T10:30:00Z',
          },
        ],
      };

      const res = await request(app)
        .post('/reset')
        .send(resetPayload);

      expect(res.statusCode).toBe(200);

      const dbSlots = await prisma.slot.findMany();
      expect(dbSlots).toHaveLength(2);
    });

    it('should delete existing bookings when resetting', async () => {
      // First ensure slot s1 exists
      await request(app)
        .post('/reset')
        .send({
          slots: [
            {
              id: 's1',
              provider: 'Dr Ade',
              start: '2026-12-10T09:00:00Z',
              end: '2026-12-10T09:30:00Z',
            },
          ],
        });

      // Create a booking
      await request(app)
        .post('/bookings')
        .send({
          slot_id: 's1',
          name: 'Ada Obi',
          email: 'ada@example.com',
        });

      let bookingsCount = await prisma.booking.count();
      expect(bookingsCount).toBe(1);

      // Reset with empty slots
      const res = await request(app)
        .post('/reset')
        .send({ slots: [] });

      expect(res.statusCode).toBe(200);

      bookingsCount = await prisma.booking.count();
      expect(bookingsCount).toBe(0);
      const slotsCount = await prisma.slot.count();
      expect(slotsCount).toBe(0);
    });
  });

  describe('GET /slots', () => {
    beforeEach(async () => {
      await request(app)
        .post('/reset')
        .send({
          slots: [
            {
              id: 'slot-2',
              provider: 'Dr Ade',
              start: '2026-12-10T11:00:00Z',
              end: '2026-12-10T11:30:00Z',
            },
            {
              id: 'slot-1',
              provider: 'Dr Bello',
              start: '2026-12-10T09:00:00Z',
              end: '2026-12-10T09:30:00Z',
            },
            {
              id: 'slot-3',
              provider: 'Dr Ade',
              start: '2026-12-10T10:00:00Z',
              end: '2026-12-10T10:30:00Z',
            },
          ],
        });
    });

    it('should sort slots by start time ascending and return ISO-8601 UTC dates', async () => {
      const res = await request(app).get('/slots');
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('slots');
      expect(res.body.slots).toHaveLength(3);

      expect(res.body.slots[0].id).toBe('slot-1');
      expect(res.body.slots[1].id).toBe('slot-3');
      expect(res.body.slots[2].id).toBe('slot-2');

      expect(res.body.slots[0].start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(res.body.slots[0].end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(res.body.slots[0].available).toBe(true);
    });

    it('should filter by provider using exact match', async () => {
      const resAde = await request(app).get('/slots?provider=Dr%20Ade');
      expect(resAde.statusCode).toBe(200);
      expect(resAde.body.slots).toHaveLength(2);
      expect(resAde.body.slots.every((s) => s.provider === 'Dr Ade')).toBe(true);

      const resPartial = await request(app).get('/slots?provider=Ade');
      expect(resPartial.statusCode).toBe(200);
      expect(resPartial.body.slots).toHaveLength(0);
    });

    it('should mark a slot as unavailable if it has a confirmed booking', async () => {
      // Book slot-3
      await request(app)
        .post('/bookings')
        .send({
          slot_id: 'slot-3',
          name: 'Ada Obi',
          email: 'ada@example.com',
        });

      const res = await request(app).get('/slots');
      expect(res.statusCode).toBe(200);

      const slot3 = res.body.slots.find((s) => s.id === 'slot-3');
      expect(slot3.available).toBe(false);

      const slot1 = res.body.slots.find((s) => s.id === 'slot-1');
      expect(slot1.available).toBe(true);
    });
  });

  describe('POST /bookings', () => {
    beforeEach(async () => {
      await request(app)
        .post('/reset')
        .send({
          slots: [
            {
              id: 's1',
              provider: 'Dr Ade',
              start: '2026-12-10T09:00:00Z',
              end: '2026-12-10T09:30:00Z',
            },
          ],
        });
    });

    it('should return 404 {"error": "slot not found"} if slot does not exist', async () => {
      const res = await request(app)
        .post('/bookings')
        .send({
          slot_id: 'unknown-slot',
          name: 'Ada Obi',
          email: 'ada@example.com',
        });

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'slot not found' });
    });

    it('should successfully create and persist a confirmed booking', async () => {
      const res = await request(app)
        .post('/bookings')
        .send({
          slot_id: 's1',
          name: 'Ada Obi',
          email: 'ada@example.com',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(typeof res.body.id).toBe('string');
      expect(res.body.slot_id).toBe('s1');
      expect(res.body.name).toBe('Ada Obi');
      expect(res.body.email).toBe('ada@example.com');
      expect(res.body.status).toBe('confirmed');
      expect(res.body).toHaveProperty('created_at');
      expect(res.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Verify persistence in PostgreSQL
      const dbBooking = await prisma.booking.findUnique({
        where: { id: res.body.id },
      });
      expect(dbBooking).not.toBeNull();
      expect(dbBooking.slot_id).toBe('s1');
      expect(dbBooking.name).toBe('Ada Obi');
      expect(dbBooking.email).toBe('ada@example.com');
      expect(dbBooking.status).toBe('confirmed');
    });
  });

  describe('GET /bookings/:id', () => {
    let bookingId;

    beforeEach(async () => {
      await request(app)
        .post('/reset')
        .send({
          slots: [
            {
              id: 's1',
              provider: 'Dr Ade',
              start: '2026-12-10T09:00:00Z',
              end: '2026-12-10T09:30:00Z',
            },
          ],
        });

      const bookingRes = await request(app)
        .post('/bookings')
        .send({
          slot_id: 's1',
          name: 'Ada Obi',
          email: 'ada@example.com',
        });
      bookingId = bookingRes.body.id;
    });

    it('should retrieve a booking by its ID', async () => {
      const res = await request(app).get(`/bookings/${bookingId}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe(bookingId);
      expect(res.body.slot_id).toBe('s1');
      expect(res.body.name).toBe('Ada Obi');
      expect(res.body.email).toBe('ada@example.com');
      expect(res.body.status).toBe('confirmed');
      expect(res.body).toHaveProperty('created_at');
      expect(res.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should return HTTP 404 with {"error": "booking not found"} if missing', async () => {
      const res = await request(app).get('/bookings/non-existent-booking-id');
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'booking not found' });
    });

    it('should include cancelled bookings when they exist', async () => {
      // Manually set status to cancelled in DB to test Level 1 requirement
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'cancelled' },
      });

      const res = await request(app).get(`/bookings/${bookingId}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe(bookingId);
      expect(res.body.status).toBe('cancelled');
    });
  });
});
