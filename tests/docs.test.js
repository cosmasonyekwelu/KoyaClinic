const request = require('supertest');
const app = require('../src/app');

describe('API Documentation & Swagger UI Verification Tests', () => {
  it('GET /openapi.json should return HTTP 200 with valid OpenAPI 3.0 document', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toHaveProperty('openapi');
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body).toHaveProperty('info');
    expect(res.body.info.title).toBe('Clinic Booking API');

    // Verify all core routes exist in the specification
    expect(res.body.paths).toHaveProperty('/health');
    expect(res.body.paths).toHaveProperty('/reset');
    expect(res.body.paths).toHaveProperty('/slots');
    expect(res.body.paths).toHaveProperty('/bookings');
    expect(res.body.paths).toHaveProperty('/bookings/{id}');

    // Verify security schemes
    expect(res.body.components.securitySchemes).toHaveProperty('ApiKeyAuth');
    expect(res.body.components.securitySchemes.ApiKeyAuth.name).toBe('X-API-Key');
  });

  it('GET /docs should return HTTP 301 or 200 and redirect/serve Swagger UI', async () => {
    const res = await request(app).get('/docs');
    expect([200, 301, 302]).toContain(res.status);
  });

  it('GET /docs/ should return HTTP 200 and serve HTML containing Swagger UI assets', async () => {
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('swagger-ui');
  });
});
