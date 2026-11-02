const http = require('http');
const app = require('../src/app');
const prisma = require('../src/db');

const API_KEY = process.env.API_KEY || 'test-api-key';

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runLevel4ConcurrencyTests() {
  console.log('--- Starting Level 4 Concurrency & Integrity Tests ---');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  try {
    // Reset database with test slots
    await makeRequest(
      {
        hostname: 'localhost',
        port,
        path: '/reset',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
        },
      },
      {
        slots: [
          {
            id: 'l4-conc-slot-1',
            provider: 'Dr Concurrency',
            start: '2026-12-10T09:00:00Z',
            end: '2026-12-10T09:30:00Z',
          },
        ],
      }
    );

    console.log('\n[Test 1] 20 concurrent requests using the SAME Idempotency-Key and SAME body...');
    const payload = {
      slot_id: 'l4-conc-slot-1',
      name: 'Concurrent Patient',
      email: 'concurrent@example.com',
    };

    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(
        makeRequest(
          {
            hostname: 'localhost',
            port,
            path: '/bookings',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': API_KEY,
              'Idempotency-Key': 'l4-simultaneous-key-1',
            },
          },
          payload
        )
      );
    }

    const results = await Promise.all(promises);

    const statuses = results.map((r) => r.status);
    const bookingIds = results.map((r) => r.body.id);
    const uniqueIds = new Set(bookingIds);

    console.log(`Results status codes: 201 count: ${statuses.filter((s) => s === 201).length}, other count: ${statuses.filter((s) => s !== 201).length}`);
    console.log(`Unique booking IDs returned across all 20 requests: ${uniqueIds.size}`);

    if (statuses.some((s) => s !== 201)) {
      throw new Error(`Expected all 20 requests to return 201, but got: ${JSON.stringify(statuses)}`);
    }

    if (uniqueIds.size !== 1) {
      throw new Error(`Expected exactly 1 unique booking ID, but got: ${uniqueIds.size}`);
    }

    const dbBookings = await prisma.booking.findMany({
      where: { slot_id: 'l4-conc-slot-1' },
    });
    console.log(`Database bookings count: ${dbBookings.length}`);
    if (dbBookings.length !== 1) {
      throw new Error(`Expected exactly 1 booking in database, but found ${dbBookings.length}`);
    }

    console.log('✓ Test 1 Passed: Exactly 1 database booking created, all 20 concurrent requests received HTTP 201 with identical booking ID.');

    console.log('\n[Test 2] Reusing the same key with different body...');
    const mismatchRes = await makeRequest(
      {
        hostname: 'localhost',
        port,
        path: '/bookings',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
          'Idempotency-Key': 'l4-simultaneous-key-1',
        },
      },
      {
        slot_id: 'l4-conc-slot-1',
        name: 'Different Patient',
        email: 'different@example.com',
      }
    );

    if (mismatchRes.status !== 422 || mismatchRes.body.error !== 'idempotency key reused with a different body') {
      throw new Error(`Expected 422 mismatch error, got ${mismatchRes.status}: ${JSON.stringify(mismatchRes.body)}`);
    }
    console.log('✓ Test 2 Passed: Key reused with different body returned HTTP 422.');

    console.log('\n=== ALL LEVEL 4 CONCURRENCY TESTS PASSED SUCCESSFULLY! ===');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runLevel4ConcurrencyTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
