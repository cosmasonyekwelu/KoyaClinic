const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/db');

const API_KEY = process.env.API_KEY || 'test-api-key';

describe('Level 3 - Double Booking Prevention & Cancellation', () => {
  beforeEach(async () => {
    // Reset database with clean test slots
    await request(app)
      .post('/reset')
      .set('X-API-Key', API_KEY)
      .send({
        slots: [
          {
            id: 'l3-slot-1',
            provider: 'Dr Level Three',
            start: '2026-12-10T09:00:00Z',
            end: '2026-12-10T09:30:00Z',
          },
          {
            id: 'l3-slot-2',
            provider: 'Dr Level Three',
            start: '2026-12-10T10:00:00Z',
            end: '2026-12-10T10:30:00Z',
          },
        ],
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Double Booking Prevention', () => {
    it('should return HTTP 409 {"error":"slot already booked"} if slot is already booked', async () => {
      // First booking succeeds
      const res1 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'l3-slot-1',
          name: 'Patient One',
          email: 'patient1@example.com',
        });

      expect(res1.status).toBe(201);

      // Second booking on same slot fails with 409
      const res2 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'l3-slot-1',
          name: 'Patient Two',
          email: 'patient2@example.com',
        });

      expect(res2.status).toBe(409);
      expect(res2.body).toEqual({ error: 'slot already booked' });

      // Verify in DB that only 1 booking exists
      const bookings = await prisma.booking.findMany({
        where: { slot_id: 'l3-slot-1' },
      });
      expect(bookings).toHaveLength(1);
      expect(bookings[0].email).toBe('patient1@example.com');
    });

    it('should handle simultaneous concurrent bookings with exactly one 201 and the rest 409', async () => {
      const concurrentRequests = 10;
      const promises = [];

      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          request(app)
            .post('/bookings')
            .set('X-API-Key', API_KEY)
            .send({
              slot_id: 'l3-slot-2',
              name: `Concurrent Patient ${i}`,
              email: `concurrent${i}@example.com`,
            })
        );
      }

      const results = await Promise.all(promises);

      const successful = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);

      expect(successful).toHaveLength(1);
      expect(conflicts).toHaveLength(concurrentRequests - 1);

      for (const res of conflicts) {
        expect(res.body).toEqual({ error: 'slot already booked' });
      }

      // Check DB records
      const confirmedBookings = await prisma.booking.findMany({
        where: {
          slot_id: 'l3-slot-2',
          status: 'confirmed',
        },
      });
      expect(confirmedBookings).toHaveLength(1);
    });
  });

  describe('2. Booking Cancellation (DELETE /bookings/:id)', () => {
    let booking;

    beforeEach(async () => {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'l3-slot-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
        });
      booking = res.body;
    });

    it('should return HTTP 401 when X-API-Key is missing or invalid on DELETE', async () => {
      const resNoKey = await request(app).delete(`/bookings/${booking.id}`);
      expect(resNoKey.status).toBe(401);
      expect(resNoKey.body).toEqual({ error: 'unauthorized' });

      const resBadKey = await request(app)
        .delete(`/bookings/${booking.id}`)
        .set('X-API-Key', 'invalid-key');
      expect(resBadKey.status).toBe(401);
      expect(resBadKey.body).toEqual({ error: 'unauthorized' });
    });

    it('should cancel an existing booking and return HTTP 200 with the full cancelled booking object', async () => {
      const res = await request(app)
        .delete(`/bookings/${booking.id}`)
        .set('X-API-Key', API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(booking.id);
      expect(res.body.slot_id).toBe(booking.slot_id);
      expect(res.body.name).toBe(booking.name);
      expect(res.body.email).toBe(booking.email);
      expect(res.body.status).toBe('cancelled');
      expect(res.body.created_at).toBe(booking.created_at);

      // Verify in DB that the record was NOT deleted, but status is cancelled
      const inDb = await prisma.booking.findUnique({
        where: { id: booking.id },
      });
      expect(inDb).not.toBeNull();
      expect(inDb.status).toBe('cancelled');
    });

    it('should return HTTP 404 {"error":"booking not found"} if the booking does not exist', async () => {
      const res = await request(app)
        .delete('/bookings/non-existent-booking-id')
        .set('X-API-Key', API_KEY);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'booking not found' });
    });

    it('should return HTTP 409 {"error":"booking already cancelled"} if cancelling an already cancelled booking', async () => {
      // First cancel succeeds
      const first = await request(app)
        .delete(`/bookings/${booking.id}`)
        .set('X-API-Key', API_KEY);
      expect(first.status).toBe(200);

      // Second cancel returns 409
      const second = await request(app)
        .delete(`/bookings/${booking.id}`)
        .set('X-API-Key', API_KEY);
      expect(second.status).toBe(409);
      expect(second.body).toEqual({ error: 'booking already cancelled' });
    });
  });

  describe('3. Slot Availability and Rebooking after Cancellation', () => {
    it('should show slot as available after cancellation and allow rebooking', async () => {
      // 1. Initial state: slot available
      let slotsRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
      let s1 = slotsRes.body.slots.find((s) => s.id === 'l3-slot-1');
      expect(s1.available).toBe(true);

      // 2. Book slot
      const bookRes = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'l3-slot-1',
          name: 'First Patient',
          email: 'first@example.com',
        });
      expect(bookRes.status).toBe(201);
      const bookingId = bookRes.body.id;

      // 3. Slot is now unavailable
      slotsRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
      s1 = slotsRes.body.slots.find((s) => s.id === 'l3-slot-1');
      expect(s1.available).toBe(false);

      // 4. Cancel booking
      const cancelRes = await request(app)
        .delete(`/bookings/${bookingId}`)
        .set('X-API-Key', API_KEY);
      expect(cancelRes.status).toBe(200);

      // 5. Slot is now available again
      slotsRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
      s1 = slotsRes.body.slots.find((s) => s.id === 'l3-slot-1');
      expect(s1.available).toBe(true);

      // 6. Another patient can now book it
      const rebookRes = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'l3-slot-1',
          name: 'Second Patient',
          email: 'second@example.com',
        });
      expect(rebookRes.status).toBe(201);
      expect(rebookRes.body.id).not.toBe(bookingId);

      // 7. Both the cancelled booking and the new booking exist in database
      const allBookings = await prisma.booking.findMany({
        where: { slot_id: 'l3-slot-1' },
      });
      expect(allBookings).toHaveLength(2);

      // 8. Cancelled booking remains retrievable via GET /bookings/:id
      const getCancelled = await request(app)
        .get(`/bookings/${bookingId}`)
        .set('X-API-Key', API_KEY);
      expect(getCancelled.status).toBe(200);
      expect(getCancelled.body.id).toBe(bookingId);
      expect(getCancelled.body.status).toBe('cancelled');
    });
  });
});
