const request = require('supertest');
const app = require('../src/app');

describe('Clinic Booking API Foundation Tests', () => {
  describe('GET /health', () => {
    it('should return 200 and { "ok": true, "db": "up" | "down" }', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(['up', 'down']).toContain(res.body.db);
    });
  });

  describe('GET /', () => {
    it('should serve HTML frontend', async () => {
      const res = await request(app).get('/');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
    });
  });

  describe('404 JSON Handler', () => {
    it('should return 404 and { "error": "Route not found" } for unmatched routes', async () => {
      const res = await request(app).get('/api/does-not-exist');
      expect(res.statusCode).toBe(404);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('Route not found');
    });
  });
});
