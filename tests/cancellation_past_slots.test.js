const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/db');

const API_KEY = process.env.API_KEY || 'test-api-key';

describe('Appointment Cancellation and Past Slot Filtering Tests', () => {
  const futureSlot1 = {
    id: 'future-slot-1',
    provider: 'Dr Future One',
    start: new Date(Date.now() + 86400000).toISOString(), // tomorrow
    end: new Date(Date.now() + 86400000 + 1800000).toISOString(),
  };

  const futureSlot2 = {
    id: 'future-slot-2',
    provider: 'Dr Future Two',
    start: new Date(Date.now() + 7200000).toISOString(), // 2 hours from now
    end: new Date(Date.now() + 9000000).toISOString(),
  };

  const pastSlot1 = {
    id: 'past-slot-1',
    provider: 'Dr Past One',
    start: new Date(Date.now() - 86400000).toISOString(), // yesterday
    end: new Date(Date.now() - 86400000 + 1800000).toISOString(),
  };

  beforeEach(async () => {
    // Reset database with clean test slots
    await request(app)
      .post('/reset')
      .set('X-API-Key', API_KEY)
      .send({
        slots: [futureSlot1, futureSlot2, pastSlot1],
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Scenario 1: Successfully cancel a valid future booking', () => {
    it('cancels a future booking and updates its status to cancelled', async () => {
      // 1. Create a future booking
      const bookRes = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: futureSlot1.id,
          name: 'Jane Doe',
          email: 'jane@example.com',
        });
      expect(bookRes.status).toBe(201);
      const bookingId = bookRes.body.id;

      // 2. Cancel the booking
      const cancelRes = await request(app)
        .delete(`/bookings/${bookingId}`)
        .set('X-API-Key', API_KEY);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.id).toBe(bookingId);
      expect(cancelRes.body.status).toBe('cancelled');

      // 3. Verify in DB record is preserved with cancelled status
      const dbBooking = await prisma.booking.findUnique({
        where: { id: bookingId },
      });
      expect(dbBooking).not.toBeNull();
      expect(dbBooking.status).toBe('cancelled');
    });
  });

  describe('Scenario 2: Reject cancellation of an already-cancelled booking', () => {
    it('returns HTTP 409 when cancelling an already cancelled booking', async () => {
      const bookRes = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: futureSlot1.id,
          name: 'Jane Doe',
          email: 'jane@example.com',
        });
      const bookingId = bookRes.body.id;

      // First cancel succeeds
      const cancelRes1 = await request(app)
        .delete(`/bookings/${bookingId}`)
        .set('X-API-Key', API_KEY);
      expect(cancelRes1.status).toBe(200);

      // Second cancel fails
      const cancelRes2 = await request(app)
        .delete(`/bookings/${bookingId}`)
        .set('X-API-Key', API_KEY);
      expect(cancelRes2.status).toBe(409);
      expect(cancelRes2.body).toEqual({ error: 'booking already cancelled' });
    });
  });

  describe('Scenario 3: Reject cancellation of a nonexistent booking', () => {
    it('returns HTTP 404 when booking does not exist', async () => {
      const res = await request(app)
        .delete('/bookings/non-existent-booking-uuid')
        .set('X-API-Key', API_KEY);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'booking not found' });
    });
  });

  describe('Scenario 4: Confirm a cancelled slot becomes available again', () => {
    it('releases the slot for future bookings upon cancellation', async () => {
      // 1. Book the slot
      const bookRes1 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: futureSlot1.id,
          name: 'Jane Doe',
          email: 'jane@example.com',
        });
      const bookingId = bookRes1.body.id;

      // Slot is unavailable
      let slotsRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
      let s1 = slotsRes.body.slots.find((s) => s.id === futureSlot1.id);
      expect(s1.available).toBe(false);

      // 2. Cancel the booking
      await request(app)
        .delete(`/bookings/${bookingId}`)
        .set('X-API-Key', API_KEY);

      // 3. Slot is now available again
      slotsRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
      s1 = slotsRes.body.slots.find((s) => s.id === futureSlot1.id);
      expect(s1.available).toBe(true);

      // 4. Another patient can book the slot
      const bookRes2 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: futureSlot1.id,
          name: 'Second Patient',
          email: 'second@example.com',
        });
      expect(bookRes2.status).toBe(201);
    });
  });

  describe('Scenario 5: Confirm past appointments are excluded from available slots', () => {
    it('excludes slots whose date and start time have passed', async () => {
      const res = await request(app).get('/slots').set('X-API-Key', API_KEY);
      expect(res.status).toBe(200);

      const slotIds = res.body.slots.map((s) => s.id);
      expect(slotIds).not.toContain(pastSlot1.id);
      expect(slotIds).toContain(futureSlot1.id);
      expect(slotIds).toContain(futureSlot2.id);
    });

    it('allows proxy endpoint /api/slots to also exclude past slots', async () => {
      const res = await request(app).get('/api/slots');
      expect(res.status).toBe(200);

      const slotIds = res.body.slots.map((s) => s.id);
      expect(slotIds).not.toContain(pastSlot1.id);
      expect(slotIds).toContain(futureSlot1.id);
    });
  });

  describe("Scenario 6: Confirm today's future appointments remain available", () => {
    it("keeps appointments occurring later today available", async () => {
      const res = await request(app).get('/slots').set('X-API-Key', API_KEY);
      expect(res.status).toBe(200);

      // futureSlot2 is set to 2 hours from now (today)
      const slot = res.body.slots.find((s) => s.id === futureSlot2.id);
      expect(slot).toBeDefined();
      expect(slot.available).toBe(true);
    });
  });

  describe('Scenario 7: Reject attempts to book an expired appointment through the API', () => {
    it('returns HTTP 400 when attempting to book a past slot directly', async () => {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: pastSlot1.id,
          name: 'Jane Doe',
          email: 'jane@example.com',
        });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'slot already started' });
    });
  });

  describe('Scenario 8: Confirm booking lookup still works after cancellation', () => {
    it('allows retrieving booking details with cancelled status via GET /bookings/:id and proxy', async () => {
      const bookRes = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: futureSlot1.id,
          name: 'Jane Doe',
          email: 'jane@example.com',
        });
      const bookingId = bookRes.body.id;

      // Cancel it
      await request(app)
        .delete(`/bookings/${bookingId}`)
        .set('X-API-Key', API_KEY);

      // Lookup via API
      const getRes = await request(app)
        .get(`/bookings/${bookingId}`)
        .set('X-API-Key', API_KEY);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(bookingId);
      expect(getRes.body.status).toBe('cancelled');

      // Lookup via Proxy /api/bookings/:id
      const proxyRes = await request(app).get(`/api/bookings/${bookingId}`);
      expect(proxyRes.status).toBe(200);
      expect(proxyRes.body.id).toBe(bookingId);
      expect(proxyRes.body.status).toBe('cancelled');
    });
  });

  describe('Past Booking Cancellation Prevention', () => {
    it('rejects cancellation of an appointment whose start time has already passed', async () => {
      // Force insert a confirmed booking for pastSlot1 in DB
      const pastBooking = await prisma.booking.create({
        data: {
          slot_id: pastSlot1.id,
          name: 'Past Patient',
          email: 'past@example.com',
          status: 'confirmed',
        },
      });

      const cancelRes = await request(app)
        .delete(`/bookings/${pastBooking.id}`)
        .set('X-API-Key', API_KEY);

      expect(cancelRes.status).toBe(400);
      expect(cancelRes.body).toEqual({ error: 'cannot cancel past appointment' });
    });
  });
});
