const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/db');
const { encodeCursor } = require('../src/utils/pagination.util');

const API_KEY = process.env.API_KEY || 'test-api-key';

describe('Level 4 - Idempotency and Booking Pagination', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Idempotency (POST /bookings with Idempotency-Key header)', () => {
    beforeEach(async () => {
      await request(app)
        .post('/reset')
        .set('X-API-Key', API_KEY)
        .send({
          slots: [
            {
              id: 'l4-slot-1',
              provider: 'Dr Idempotent',
              start: '2026-12-10T09:00:00Z',
              end: '2026-12-10T09:30:00Z',
            },
            {
              id: 'l4-slot-2',
              provider: 'Dr Idempotent',
              start: '2026-12-10T10:00:00Z',
              end: '2026-12-10T10:30:00Z',
            },
            {
              id: 'l4-slot-past',
              provider: 'Dr Idempotent',
              start: '2020-01-01T10:00:00Z',
              end: '2020-01-01T10:30:00Z',
            },
          ],
        });
    });

    it('should return HTTP 201 for the first request and identical response with same booking ID on replay', async () => {
      const idempotencyKey = 'key-replay-1';
      const payload = {
        slot_id: 'l4-slot-1',
        name: 'Chioma Okeke',
        email: 'chioma@example.com',
      };

      // First request
      const res1 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);
      expect(res1.body).toHaveProperty('id');
      const firstBookingId = res1.body.id;

      // Second request (replay with same key and same body)
      const res2 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.id).toBe(firstBookingId);
      expect(res2.body).toEqual(res1.body);

      // Verify that only ONE database booking was created
      const dbBookings = await prisma.booking.findMany({
        where: { slot_id: 'l4-slot-1' },
      });
      expect(dbBookings).toHaveLength(1);
      expect(dbBookings[0].id).toBe(firstBookingId);

      // Verify IdempotencyKey model persistence
      const storedKey = await prisma.idempotencyKey.findUnique({
        where: { key: idempotencyKey },
      });
      expect(storedKey).not.toBeNull();
      expect(storedKey.statusCode).toBe(201);
      expect(storedKey.responseBody.id).toBe(firstBookingId);
    });

    it('should normalize payload before hashing (same key with differently formatted but equivalent body succeeds)', async () => {
      const idempotencyKey = 'key-normalized-1';

      // First request with extra spaces and uppercase email
      const res1 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          slot_id: '  l4-slot-1  ',
          name: '  Chioma Okeke  ',
          email: '  CHIOMA@example.COM  ',
        });

      expect(res1.status).toBe(201);

      // Second request with normalized values
      const res2 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          slot_id: 'l4-slot-1',
          name: 'Chioma Okeke',
          email: 'chioma@example.com',
        });

      expect(res2.status).toBe(201);
      expect(res2.body.id).toBe(res1.body.id);
    });

    it('should return HTTP 422 {"error":"idempotency key reused with a different body"} when same key is used with a different body', async () => {
      const idempotencyKey = 'key-mismatch-1';

      // First request
      const res1 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          slot_id: 'l4-slot-1',
          name: 'Patient A',
          email: 'patientA@example.com',
        });

      expect(res1.status).toBe(201);

      // Reused key with different slot_id
      const res2 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          slot_id: 'l4-slot-2',
          name: 'Patient A',
          email: 'patientA@example.com',
        });

      expect(res2.status).toBe(422);
      expect(res2.body).toEqual({ error: 'idempotency key reused with a different body' });

      // Reused key with different name
      const res3 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          slot_id: 'l4-slot-1',
          name: 'Patient B',
          email: 'patientA@example.com',
        });

      expect(res3.status).toBe(422);
      expect(res3.body).toEqual({ error: 'idempotency key reused with a different body' });
    });

    it('should safely handle concurrent requests with the exact same idempotency key and create only 1 booking', async () => {
      const idempotencyKey = 'key-concurrent-1';
      const payload = {
        slot_id: 'l4-slot-1',
        name: 'Concurrent Patient',
        email: 'concurrent@example.com',
      };

      const concurrencyCount = 10;
      const promises = [];

      for (let i = 0; i < concurrencyCount; i++) {
        promises.push(
          request(app)
            .post('/bookings')
            .set('X-API-Key', API_KEY)
            .set('Idempotency-Key', idempotencyKey)
            .send(payload)
        );
      }

      const responses = await Promise.all(promises);

      // Every response should be 201 with identical body and ID
      const firstId = responses[0].body.id;
      for (const res of responses) {
        expect(res.status).toBe(201);
        expect(res.body.id).toBe(firstId);
      }

      // Check DB: exactly one booking in DB
      const dbBookings = await prisma.booking.findMany({
        where: { slot_id: 'l4-slot-1' },
      });
      expect(dbBookings).toHaveLength(1);
    });

    it('should store and replay applicable 4xx responses (404 slot not found, 400 slot already started, 409 slot already booked)', async () => {
      // 1. 404 Slot not found
      const key404 = 'key-404';
      const res404 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', key404)
        .send({
          slot_id: 'nonexistent-slot',
          name: 'Some Name',
          email: 'some@example.com',
        });
      expect(res404.status).toBe(404);
      expect(res404.body).toEqual({ error: 'slot not found' });

      // Replay 404
      const replay404 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', key404)
        .send({
          slot_id: 'nonexistent-slot',
          name: 'Some Name',
          email: 'some@example.com',
        });
      expect(replay404.status).toBe(404);
      expect(replay404.body).toEqual({ error: 'slot not found' });

      // 2. 400 Slot already started
      const key400 = 'key-400';
      const res400 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', key400)
        .send({
          slot_id: 'l4-slot-past',
          name: 'Some Name',
          email: 'some@example.com',
        });
      expect(res400.status).toBe(400);
      expect(res400.body).toEqual({ error: 'slot already started' });

      // Replay 400
      const replay400 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', key400)
        .send({
          slot_id: 'l4-slot-past',
          name: 'Some Name',
          email: 'some@example.com',
        });
      expect(replay400.status).toBe(400);
      expect(replay400.body).toEqual({ error: 'slot already started' });

      // 3. 409 Slot already booked
      // First book slot 1 without key
      await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'l4-slot-1',
          name: 'Initial Patient',
          email: 'init@example.com',
        });

      // Now attempt to book with key 409
      const key409 = 'key-409';
      const res409 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', key409)
        .send({
          slot_id: 'l4-slot-1',
          name: 'Conflicting Patient',
          email: 'conflict@example.com',
        });
      expect(res409.status).toBe(409);
      expect(res409.body).toEqual({ error: 'slot already booked' });

      // Replay 409
      const replay409 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', key409)
        .send({
          slot_id: 'l4-slot-1',
          name: 'Conflicting Patient',
          email: 'conflict@example.com',
        });
      expect(replay409.status).toBe(409);
      expect(replay409.body).toEqual({ error: 'slot already booked' });
    });

    it('should NOT store 401 unauthorized responses', async () => {
      const key401 = 'key-401';
      const res401 = await request(app)
        .post('/bookings')
        .set('X-API-Key', 'invalid-key')
        .set('Idempotency-Key', key401)
        .send({
          slot_id: 'l4-slot-1',
          name: 'Patient',
          email: 'patient@example.com',
        });
      expect(res401.status).toBe(401);

      const record = await prisma.idempotencyKey.findUnique({
        where: { key: key401 },
      });
      expect(record).toBeNull();
    });

    it('should allow requests without Idempotency-Key to follow normal booking behavior', async () => {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'l4-slot-1',
          name: 'Regular Patient',
          email: 'regular@example.com',
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
    });

    it('should persist idempotency records across application restarts', async () => {
      const idempotencyKey = 'key-restart-persist';
      const payload = {
        slot_id: 'l4-slot-1',
        name: 'Persist Patient',
        email: 'persist@example.com',
      };

      const res1 = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);

      // Verify persisted directly in PostgreSQL
      const persistedInDb = await prisma.idempotencyKey.findUnique({
        where: { key: idempotencyKey },
      });
      expect(persistedInDb).not.toBeNull();
      expect(persistedInDb.statusCode).toBe(201);
      expect(persistedInDb.responseBody.id).toBe(res1.body.id);

      // Re-requiring app simulates fresh handler / restart
      const freshApp = require('../src/app');
      const res2 = await request(freshApp)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body).toEqual(res1.body);
    });
  });

  describe('2. Booking Pagination (GET /bookings)', () => {
    const userEmail = 'pagination.user@example.com';
    const otherEmail = 'other.user@example.com';
    const totalSlots = 25;

    beforeEach(async () => {
      // Create 25 slots and book them sequentially
      const slots = [];
      for (let i = 1; i <= totalSlots; i++) {
        const hour = 9 + Math.floor(i / 2);
        const min = (i % 2) * 30;
        const timeStr = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:00Z`;
        slots.push({
          id: `page-slot-${i}`,
          provider: 'Dr Page',
          start: `2027-01-01T${timeStr}`,
          end: `2027-01-01T${timeStr}`,
        });
      }

      await request(app)
        .post('/reset')
        .set('X-API-Key', API_KEY)
        .send({ slots });

      // Create 20 bookings for userEmail with controlled timestamps
      for (let i = 1; i <= 20; i++) {
        await prisma.booking.create({
          data: {
            id: `booking-${i.toString().padStart(3, '0')}`,
            slot_id: `page-slot-${i}`,
            name: `Patient ${i}`,
            email: userEmail,
            status: i % 4 === 0 ? 'cancelled' : 'confirmed',
            created_at: new Date(Date.UTC(2026, 0, 1, 10, i, 0)),
          },
        });
      }

      // Create 5 bookings for otherEmail
      for (let i = 21; i <= 25; i++) {
        await prisma.booking.create({
          data: {
            id: `booking-${i.toString().padStart(3, '0')}`,
            slot_id: `page-slot-${i}`,
            name: `Other Patient ${i}`,
            email: otherEmail,
            status: 'confirmed',
            created_at: new Date(Date.UTC(2026, 0, 1, 10, i, 0)),
          },
        });
      }
    });

    it('should return HTTP 400 if email is missing or empty', async () => {
      const resNoEmail = await request(app)
        .get('/bookings')
        .set('X-API-Key', API_KEY);
      expect(resNoEmail.status).toBe(400);

      const resEmptyEmail = await request(app)
        .get('/bookings?email=%20%20')
        .set('X-API-Key', API_KEY);
      expect(resEmptyEmail.status).toBe(400);
    });

    it('should return HTTP 400 for invalid limits: 0, 51, negative, or non-numeric', async () => {
      const res0 = await request(app)
        .get(`/bookings?email=${userEmail}&limit=0`)
        .set('X-API-Key', API_KEY);
      expect(res0.status).toBe(400);

      const res51 = await request(app)
        .get(`/bookings?email=${userEmail}&limit=51`)
        .set('X-API-Key', API_KEY);
      expect(res51.status).toBe(400);

      const resNeg = await request(app)
        .get(`/bookings?email=${userEmail}&limit=-5`)
        .set('X-API-Key', API_KEY);
      expect(resNeg.status).toBe(400);

      const resAlpha = await request(app)
        .get(`/bookings?email=${userEmail}&limit=abc`)
        .set('X-API-Key', API_KEY);
      expect(resAlpha.status).toBe(400);
    });

    it('should return HTTP 400 for invalid cursors', async () => {
      const resInvalidBase64 = await request(app)
        .get(`/bookings?email=${userEmail}&cursor=invalid!!!cursor`)
        .set('X-API-Key', API_KEY);
      expect(resInvalidBase64.status).toBe(400);

      const encodedBadJson = Buffer.from('{"created_at":"not-a-date","id":"123"}').toString('base64url');
      const resBadDate = await request(app)
        .get(`/bookings?email=${userEmail}&cursor=${encodedBadJson}`)
        .set('X-API-Key', API_KEY);
      expect(resBadDate.status).toBe(400);
    });

    it('should return empty results with next_cursor null when user has no bookings', async () => {
      const res = await request(app)
        .get('/bookings?email=nobody@example.com')
        .set('X-API-Key', API_KEY);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        bookings: [],
        next_cursor: null,
      });
    });

    it('should filter email case-insensitively and trim input email', async () => {
      const res = await request(app)
        .get(`/bookings?email=%20%20PAGINATION.USER@EXAMPLE.COM%20%20&limit=5`)
        .set('X-API-Key', API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.bookings).toHaveLength(5);
      expect(res.body.bookings.every((b) => b.email === userEmail)).toBe(true);
    });

    it('should return confirmed and cancelled bookings sorted oldest first (created_at ASC, id ASC)', async () => {
      const res = await request(app)
        .get(`/bookings?email=${userEmail}&limit=10`)
        .set('X-API-Key', API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.bookings).toHaveLength(10);

      const statuses = res.body.bookings.map((b) => b.status);
      expect(statuses).toContain('confirmed');
      expect(statuses).toContain('cancelled');

      // Check sorting oldest first
      for (let i = 1; i < res.body.bookings.length; i++) {
        const prev = new Date(res.body.bookings[i - 1].created_at).getTime();
        const curr = new Date(res.body.bookings[i].created_at).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
        if (curr === prev) {
          expect(res.body.bookings[i].id > res.body.bookings[i - 1].id).toBe(true);
        }
      }
    });

    it('should paginate correctly across first, subsequent, and final pages with no duplicate records', async () => {
      const limit = 8;
      let allRetrievedBookings = [];
      let cursor = null;
      let pageCount = 0;

      while (true) {
        pageCount++;
        let url = `/bookings?email=${userEmail}&limit=${limit}`;
        if (cursor) {
          url += `&cursor=${cursor}`;
        }

        const res = await request(app)
          .get(url)
          .set('X-API-Key', API_KEY);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('bookings');
        expect(res.body).toHaveProperty('next_cursor');

        allRetrievedBookings = allRetrievedBookings.concat(res.body.bookings);

        if (res.body.next_cursor === null) {
          // Final page reached
          break;
        }

        cursor = res.body.next_cursor;
      }

      // We seeded 20 bookings for userEmail
      expect(allRetrievedBookings).toHaveLength(20);
      expect(pageCount).toBe(3); // 8 on page 1, 8 on page 2, 4 on page 3

      // Verify NO duplicates
      const ids = allRetrievedBookings.map((b) => b.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(20);
    });
  });
});
