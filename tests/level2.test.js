const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/db');

const VALID_API_KEY = process.env.API_KEY || 'test-api-key';
const INVALID_API_KEY = 'incorrect-key-12345';

describe('Level 2 - Authentication, Input Validation & Slot Rules', () => {
  beforeEach(async () => {
    // Reset database with clean test slots:
    // s-future: future slot
    // s-past: slot in the past
    await request(app)
      .post('/reset')
      .set('X-API-Key', VALID_API_KEY)
      .send({
        slots: [
          {
            id: 's-future',
            provider: 'Dr Future',
            start: '2026-12-10T09:00:00Z',
            end: '2026-12-10T09:30:00Z',
          },
          {
            id: 's-past',
            provider: 'Dr Past',
            start: '2020-01-01T08:00:00Z',
            end: '2020-01-01T08:30:00Z',
          },
        ],
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. API Key Authentication', () => {
    it('should return HTTP 401 {"error":"unauthorized"} when X-API-Key header is missing', async () => {
      const resReset = await request(app).post('/reset').send({ slots: [] });
      expect(resReset.status).toBe(401);
      expect(resReset.body).toEqual({ error: 'unauthorized' });

      const resSlots = await request(app).get('/slots');
      expect(resSlots.status).toBe(401);
      expect(resSlots.body).toEqual({ error: 'unauthorized' });

      const resBookings = await request(app).post('/bookings').send({});
      expect(resBookings.status).toBe(401);
      expect(resBookings.body).toEqual({ error: 'unauthorized' });

      const resBookingGet = await request(app).get('/bookings/any-id');
      expect(resBookingGet.status).toBe(401);
      expect(resBookingGet.body).toEqual({ error: 'unauthorized' });
    });

    it('should return HTTP 401 {"error":"unauthorized"} when X-API-Key is invalid', async () => {
      const res = await request(app)
        .get('/slots')
        .set('X-API-Key', INVALID_API_KEY);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'unauthorized' });
    });

    it('should allow access when valid X-API-Key is supplied', async () => {
      const res = await request(app)
        .get('/slots')
        .set('X-API-Key', VALID_API_KEY);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('slots');
    });

    it('should keep public endpoints accessible without API key', async () => {
      const resHealth = await request(app).get('/health');
      expect(resHealth.status).toBe(200);
      expect(resHealth.body).toEqual({ ok: true });

      const resHome = await request(app).get('/');
      expect(resHome.status).toBe(200);
    });
  });

  describe('2. Booking Validation (POST /bookings)', () => {
    it('should reject missing slot_id with HTTP 400', async () => {
      const initialCount = await prisma.booking.count();
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', VALID_API_KEY)
        .send({
          name: 'Ada Obi',
          email: 'ada@example.com',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      const finalCount = await prisma.booking.count();
      expect(finalCount).toBe(initialCount);
    });

    it('should reject missing name with HTTP 400', async () => {
      const initialCount = await prisma.booking.count();
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', VALID_API_KEY)
        .send({
          slot_id: 's-future',
          email: 'ada@example.com',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      const finalCount = await prisma.booking.count();
      expect(finalCount).toBe(initialCount);
    });

    it('should reject missing email with HTTP 400', async () => {
      const initialCount = await prisma.booking.count();
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', VALID_API_KEY)
        .send({
          slot_id: 's-future',
          name: 'Ada Obi',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      const finalCount = await prisma.booking.count();
      expect(finalCount).toBe(initialCount);
    });

    it('should reject empty strings or whitespace-only strings with HTTP 400', async () => {
      const testCases = [
        { slot_id: '', name: 'Ada', email: 'ada@example.com' },
        { slot_id: '   ', name: 'Ada', email: 'ada@example.com' },
        { slot_id: 's-future', name: '', email: 'ada@example.com' },
        { slot_id: 's-future', name: '   ', email: 'ada@example.com' },
        { slot_id: 's-future', name: 'Ada', email: '' },
        { slot_id: 's-future', name: 'Ada', email: '   ' },
      ];

      for (const payload of testCases) {
        const res = await request(app)
          .post('/bookings')
          .set('X-API-Key', VALID_API_KEY)
          .send(payload);

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
      }

      const count = await prisma.booking.count();
      expect(count).toBe(0);
    });

    it('should reject invalid data types (numbers, booleans, objects, arrays)', async () => {
      const testCases = [
        { slot_id: 123, name: 'Ada', email: 'ada@example.com' },
        { slot_id: 's-future', name: { first: 'Ada' }, email: 'ada@example.com' },
        { slot_id: 's-future', name: 'Ada', email: ['ada@example.com'] },
        { slot_id: 's-future', name: 'Ada', email: true },
      ];

      for (const payload of testCases) {
        const res = await request(app)
          .post('/bookings')
          .set('X-API-Key', VALID_API_KEY)
          .send(payload);

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
      }

      const count = await prisma.booking.count();
      expect(count).toBe(0);
    });

    it('should reject invalid email formats with HTTP 400', async () => {
      const invalidEmails = [
        'plainaddress',
        '@missingusername.com',
        'username@.com',
        'username@domain',
        'username@domain.',
        'username space@domain.com',
      ];

      for (const badEmail of invalidEmails) {
        const res = await request(app)
          .post('/bookings')
          .set('X-API-Key', VALID_API_KEY)
          .send({
            slot_id: 's-future',
            name: 'Ada Obi',
            email: badEmail,
          });

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
      }

      const count = await prisma.booking.count();
      expect(count).toBe(0);
    });

    it('should trim whitespace from name and email, and lowercase email', async () => {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', VALID_API_KEY)
        .send({
          slot_id: '  s-future  ',
          name: '   Ada Lovelace   ',
          email: '  ADA.Lovelace@Example.COM   ',
        });

      expect(res.status).toBe(201);
      expect(res.body.slot_id).toBe('s-future');
      expect(res.body.name).toBe('Ada Lovelace');
      expect(res.body.email).toBe('ada.lovelace@example.com');

      // Verify in DB
      const persisted = await prisma.booking.findUnique({
        where: { id: res.body.id },
      });
      expect(persisted.name).toBe('Ada Lovelace');
      expect(persisted.email).toBe('ada.lovelace@example.com');
    });
  });

  describe('3. Slot Validation', () => {
    it('should return HTTP 404 {"error":"slot not found"} if slot does not exist', async () => {
      const initialCount = await prisma.booking.count();
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', VALID_API_KEY)
        .send({
          slot_id: 'non-existent-slot',
          name: 'Ada Obi',
          email: 'ada@example.com',
        });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'slot not found' });

      const finalCount = await prisma.booking.count();
      expect(finalCount).toBe(initialCount);
    });

    it('should return HTTP 400 {"error":"slot already started"} if slot is in the past', async () => {
      const initialCount = await prisma.booking.count();
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', VALID_API_KEY)
        .send({
          slot_id: 's-past',
          name: 'Ada Obi',
          email: 'ada@example.com',
        });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'slot already started' });

      const finalCount = await prisma.booking.count();
      expect(finalCount).toBe(initialCount);
    });
  });
});
