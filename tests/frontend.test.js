const request = require('supertest');
const app = require('../src/app');

describe('Clinic Booking Frontend & Proxy API Integration Tests', () => {
  describe('1. Static Frontend Serving', () => {
    it('GET / should return 200 and serve HTML containing booking interface', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toContain('Koya Clinic');
      expect(res.text).toContain('Available Appointments');
      expect(res.text).toContain('Book an Appointment');
      expect(res.text).toContain('Find an Existing Booking');
      expect(res.text).toContain('app.js');
      expect(res.text).toContain('styles.css');
    });

    it('GET /styles.css should return 200 and CSS content', async () => {
      const res = await request(app).get('/styles.css');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/css/);
      expect(res.text).toContain('.slot-card');
    });

    it('GET /app.js should return 200 and JavaScript content', async () => {
      const res = await request(app).get('/app.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
      expect(res.text).toContain('/api/slots');
    });
  });

  describe('2. Secure Client Proxy Endpoints', () => {
    it('GET /api/slots should proxy requests to the deployed API without requiring client API key', async () => {
      const res = await request(app).get('/api/slots');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('slots');
      expect(Array.isArray(res.body.slots)).toBe(true);

      if (res.body.slots.length > 0) {
        const slot = res.body.slots[0];
        expect(slot).toHaveProperty('id');
        expect(slot).toHaveProperty('provider');
        expect(slot).toHaveProperty('start');
        expect(slot).toHaveProperty('end');
        expect(slot).toHaveProperty('available');
      }
    });

    it('GET /api/slots with provider filter should return filtered slots', async () => {
      const res = await request(app).get('/api/slots?provider=Dr%20Ade');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('slots');
      res.body.slots.forEach(slot => {
        expect(slot.provider).toBe('Dr Ade');
      });
    });

    it('POST /api/bookings with invalid payload should return validation error from deployed API', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .send({
          slot_id: 'non-existent-slot-12345',
          name: 'Jane Doe',
          email: 'jane@example.com',
        });

      expect([400, 404, 409]).toContain(res.status);
      expect(res.body).toHaveProperty('error');
    });

    it('GET /api/bookings/:id for non-existent booking should return 404', async () => {
      const res = await request(app).get('/api/bookings/non-existent-booking-id-99999');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
});
