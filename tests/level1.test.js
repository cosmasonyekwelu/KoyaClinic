const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/db');

const API_KEY = process.env.API_KEY || 'test-api-key';

describe('Level 1 - Clinic Booking API (with Level 2 Auth)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /reset', () => {
    it('should reset slots and bookings, returning HTTP 200', async () => {
      const resetPayload = {
        slots: [
          {
            id: 's1',
            provider: 'Dr Ade',
            start: '2026-12-10T09:00:00Z',
            end: '2026-12-10T09:30:00Z',
          },
          {
            id: 's2',
            provider: 'Dr Chioma',
            start: '2020-01-01T08:00:00Z',
            end: '2020-01-01T08:30:00Z',
          },
        ],
      };

      const response = await request(app)
        .post('/reset')
        .set('X-API-Key', API_KEY)
        .send(resetPayload);

      expect(response.status).toBe(200);

      // Verify slots in database
      const count = await prisma.slot.count();
      expect(count).toBe(2);

      const slot1 = await prisma.slot.findUnique({ where: { id: 's1' } });
      expect(slot1).not.toBeNull();
      expect(slot1.provider).toBe('Dr Ade');
    });

    it('should accept past slots', async () => {
      const pastSlotPayload = {
        slots: [
          {
            id: 'past-1',
            provider: 'Dr Past',
            start: '2019-05-10T10:00:00Z',
            end: '2019-05-10T10:30:00Z',
          },
        ],
      };

      const response = await request(app)
        .post('/reset')
        .set('X-API-Key', API_KEY)
        .send(pastSlotPayload);

      expect(response.status).toBe(200);

      const slot = await prisma.slot.findUnique({ where: { id: 'past-1' } });
      expect(slot).not.toBeNull();
      expect(slot.start.toISOString()).toBe('2019-05-10T10:00:00.000Z');
    });

    it('should execute operation inside a database transaction (atomicity)', async () => {
      // First ensure baseline with 1 slot
      await request(app)
        .post('/reset')
        .set('X-API-Key', API_KEY)
        .send({
          slots: [
            {
              id: 'init-1',
              provider: 'Dr Init',
              start: '2026-12-10T09:00:00Z',
              end: '2026-12-10T09:30:00Z',
            },
          ],
        });

      // Send payload with invalid slot (violates non-null provider)
      const invalidPayload = {
        slots: [
          {
            id: 'new-valid',
            provider: 'Dr Valid',
            start: '2026-12-10T10:00:00Z',
            end: '2026-12-10T10:30:00Z',
          },
          {
            id: 'new-invalid',
            provider: null, // violates DB schema constraint
            start: '2026-12-10T11:00:00Z',
            end: '2026-12-10T11:30:00Z',
          },
        ],
      };

      const response = await request(app)
        .post('/reset')
        .set('X-API-Key', API_KEY)
        .send(invalidPayload);

      expect(response.status).toBe(500);

      // Verify that rollback occurred and original slot remains
      const initSlot = await prisma.slot.findUnique({ where: { id: 'init-1' } });
      expect(initSlot).not.toBeNull();
      const validSlot = await prisma.slot.findUnique({ where: { id: 'new-valid' } });
      expect(validSlot).toBeNull();
    });
  });

  describe('GET /slots', () => {
    beforeEach(async () => {
      await request(app)
        .post('/reset')
        .set('X-API-Key', API_KEY)
        .send({
          slots: [
            {
              id: 's3',
              provider: 'Dr Musa',
              start: '2026-12-10T12:00:00Z',
              end: '2026-12-10T12:30:00Z',
            },
            {
              id: 's1',
              provider: 'Dr Ade',
              start: '2026-12-10T09:00:00Z',
              end: '2026-12-10T09:30:00Z',
            },
            {
              id: 's2',
              provider: 'Dr Ade',
              start: '2026-12-10T10:00:00Z',
              end: '2026-12-10T10:30:00Z',
            },
          ],
        });
    });

    it('should sort slots by start time ascending and return ISO-8601 UTC dates', async () => {
      const response = await request(app)
        .get('/slots')
        .set('X-API-Key', API_KEY);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('slots');
      expect(response.body.slots).toHaveLength(3);

      expect(response.body.slots[0].id).toBe('s1');
      expect(response.body.slots[0].start).toBe('2026-12-10T09:00:00.000Z');
      expect(response.body.slots[0].available).toBe(true);

      expect(response.body.slots[1].id).toBe('s2');
      expect(response.body.slots[1].start).toBe('2026-12-10T10:00:00.000Z');
      expect(response.body.slots[1].available).toBe(true);

      expect(response.body.slots[2].id).toBe('s3');
      expect(response.body.slots[2].start).toBe('2026-12-10T12:00:00.000Z');
      expect(response.body.slots[2].available).toBe(true);
    });

    it('should support provider filtering with exact matching', async () => {
      // Filter for exact "Dr Ade"
      const resAde = await request(app)
        .get('/slots?provider=Dr%20Ade')
        .set('X-API-Key', API_KEY);
      expect(resAde.status).toBe(200);
      expect(resAde.body.slots).toHaveLength(2);
      expect(resAde.body.slots.every((s) => s.provider === 'Dr Ade')).toBe(true);

      // Exact matching: partial match or lower case should return empty
      const resPartial = await request(app)
        .get('/slots?provider=Ade')
        .set('X-API-Key', API_KEY);
      expect(resPartial.status).toBe(200);
      expect(resPartial.body.slots).toHaveLength(0);

      const resCase = await request(app)
        .get('/slots?provider=dr%20ade')
        .set('X-API-Key', API_KEY);
      expect(resCase.status).toBe(200);
      expect(resCase.body.slots).toHaveLength(0);
    });

    it('should mark a slot as unavailable if it has a confirmed booking', async () => {
      // Book slot s1
      await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 's1',
          name: 'Ada Obi',
          email: 'ada@example.com',
        });

      const response = await request(app)
        .get('/slots')
        .set('X-API-Key', API_KEY);
      expect(response.status).toBe(200);

      const s1 = response.body.slots.find((s) => s.id === 's1');
      expect(s1.available).toBe(false);

      const s2 = response.body.slots.find((s) => s.id === 's2');
      expect(s2.available).toBe(true);
    });
  });

  describe('POST /bookings', () => {
    beforeEach(async () => {
      await request(app)
        .post('/reset')
        .set('X-API-Key', API_KEY)
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

    it('should successfully create a confirmed booking and return HTTP 201', async () => {
      const response = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 's1',
          name: 'Ada Obi',
          email: 'ada@example.com',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(typeof response.body.id).toBe('string');
      expect(response.body.slot_id).toBe('s1');
      expect(response.body.name).toBe('Ada Obi');
      expect(response.body.email).toBe('ada@example.com');
      expect(response.body.status).toBe('confirmed');
      expect(response.body).toHaveProperty('created_at');
      expect(new Date(response.body.created_at).toISOString()).toBe(response.body.created_at);

      // Verify persistence in PostgreSQL
      const persisted = await prisma.booking.findUnique({
        where: { id: response.body.id },
      });
      expect(persisted).not.toBeNull();
      expect(persisted.name).toBe('Ada Obi');
      expect(persisted.email).toBe('ada@example.com');
      expect(persisted.status).toBe('confirmed');
    });

    it('should return HTTP 404 with {"error": "slot not found"} for an unknown slot', async () => {
      const response = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'unknown-slot-999',
          name: 'Ada Obi',
          email: 'ada@example.com',
        });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'slot not found' });
    });
  });

  describe('GET /bookings/:id', () => {
    let createdBooking;

    beforeEach(async () => {
      await request(app)
        .post('/reset')
        .set('X-API-Key', API_KEY)
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

      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 's1',
          name: 'Ada Obi',
          email: 'ada@example.com',
        });
      createdBooking = res.body;
    });

    it('should retrieve a booking by its ID and return HTTP 200 with identical structure', async () => {
      const response = await request(app)
        .get(`/bookings/${createdBooking.id}`)
        .set('X-API-Key', API_KEY);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(createdBooking);
    });

    it('should include cancelled bookings when they exist', async () => {
      // Update status to cancelled in DB directly
      await prisma.booking.update({
        where: { id: createdBooking.id },
        data: { status: 'cancelled' },
      });

      const response = await request(app)
        .get(`/bookings/${createdBooking.id}`)
        .set('X-API-Key', API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(createdBooking.id);
      expect(response.body.status).toBe('cancelled');
    });

    it('should return HTTP 404 with {"error": "booking not found"} for missing booking', async () => {
      const response = await request(app)
        .get('/bookings/non-existent-booking-id')
        .set('X-API-Key', API_KEY);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'booking not found' });
    });
  });
});
