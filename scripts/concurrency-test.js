/**
 * Concurrency test script for Level 3 of Koya Academy Clinic Booking API.
 * Uses real PostgreSQL database connection.
 *
 * Verifies:
 * 1. 20 genuinely concurrent requests targeting the same slot:
 *    - Exactly one HTTP 201
 *    - The remaining 19 requests receive HTTP 409 {"error":"slot already booked"}
 *    - Exactly one confirmed booking exists in database
 *    - No duplicate active records exist
 * 2. Cancel and rebook:
 *    - A cancelled slot can be booked again by a new request (HTTP 201)
 *    - Slot availability correctly updates
 * 3. Cancel twice:
 *    - First cancellation receives HTTP 200
 *    - Second cancellation receives HTTP 409 {"error":"booking already cancelled"}
 * 4. Cancel nonexistent booking:
 *    - Receives HTTP 404 {"error":"booking not found"}
 * 5. Concurrent cancellation attempts:
 *    - Multiple simultaneous cancellation requests for the same booking
 *    - Exactly one succeeds (200), remainder return 409
 * 6. Booking different slots simultaneously:
 *    - Concurrent requests targeting distinct slots both succeed (HTTP 201)
 */

const http = require('http');
const app = require('../src/app');
const prisma = require('../src/db');

const API_KEY = process.env.API_KEY || 'test-api-key';

function makeRequest({ method, path, headers = {}, body = null, port }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'X-API-Key': API_KEY,
      ...headers,
    };

    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', (err) => reject(err));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function run() {
  console.log('--- Starting Level 3 Real PostgreSQL Concurrency Tests ---');

  // Start server on an ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  try {
    // ---------------------------------------------------------
    // TEST 1: 20 CONCURRENT BOOKINGS FOR THE SAME SLOT
    // ---------------------------------------------------------
    console.log('\n[Test 1] 20 genuinely concurrent booking requests targeting the same slot...');

    // Reset database with a fresh slot
    await makeRequest({
      method: 'POST',
      path: '/reset',
      port,
      body: {
        slots: [
          {
            id: 'slot-concurrency-1',
            provider: 'Dr Concurrent',
            start: '2026-12-10T09:00:00Z',
            end: '2026-12-10T09:30:00Z',
          },
        ],
      },
    });

    const CONCURRENCY_COUNT = 20;
    const bookingPromises = [];

    for (let i = 1; i <= CONCURRENCY_COUNT; i++) {
      bookingPromises.push(
        makeRequest({
          method: 'POST',
          path: '/bookings',
          port,
          body: {
            slot_id: 'slot-concurrency-1',
            name: `Patient ${i}`,
            email: `patient${i}@example.com`,
          },
        })
      );
    }

    const results = await Promise.all(bookingPromises);

    const successful = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    const others = results.filter((r) => r.status !== 201 && r.status !== 409);

    console.log(`Results: ${successful.length} HTTP 201, ${conflicts.length} HTTP 409, ${others.length} Unexpected`);

    if (successful.length !== 1) {
      throw new Error(`Expected exactly 1 HTTP 201, got ${successful.length}`);
    }
    if (conflicts.length !== CONCURRENCY_COUNT - 1) {
      throw new Error(`Expected ${CONCURRENCY_COUNT - 1} HTTP 409, got ${conflicts.length}`);
    }
    for (const conflict of conflicts) {
      if (conflict.body.error !== 'slot already booked') {
        throw new Error(`Expected error 'slot already booked', got: ${JSON.stringify(conflict.body)}`);
      }
    }

    // Direct Database Verification
    const dbConfirmedBookings = await prisma.booking.findMany({
      where: {
        slot_id: 'slot-concurrency-1',
        status: 'confirmed',
      },
    });

    console.log(`Database confirmed bookings count: ${dbConfirmedBookings.length}`);
    if (dbConfirmedBookings.length !== 1) {
      throw new Error(`Database has ${dbConfirmedBookings.length} confirmed bookings, expected exactly 1!`);
    }

    const allDbBookings = await prisma.booking.findMany({
      where: {
        slot_id: 'slot-concurrency-1',
      },
    });
    console.log(`Database total bookings count for slot: ${allDbBookings.length}`);
    if (allDbBookings.length !== 1) {
      throw new Error(`Database total bookings is ${allDbBookings.length}, expected exactly 1!`);
    }

    console.log('✓ Test 1 Passed: Exactly one booking succeeded, 19 rejected with 409, 0 duplicate records.');

    const initialBookingId = successful[0].body.id;

    // ---------------------------------------------------------
    // TEST 2: CANCEL AND REBOOK
    // ---------------------------------------------------------
    console.log('\n[Test 2] Cancel and rebook...');

    // Cancel the confirmed booking
    const cancelRes = await makeRequest({
      method: 'DELETE',
      path: `/bookings/${initialBookingId}`,
      port,
    });

    if (cancelRes.status !== 200) {
      throw new Error(`Expected HTTP 200 on cancel, got ${cancelRes.status}: ${JSON.stringify(cancelRes.body)}`);
    }
    if (cancelRes.body.status !== 'cancelled' || cancelRes.body.id !== initialBookingId) {
      throw new Error(`Cancelled booking payload mismatch: ${JSON.stringify(cancelRes.body)}`);
    }

    // Check slot is now available
    const slotsRes = await makeRequest({
      method: 'GET',
      path: '/slots',
      port,
    });
    const slotObj = slotsRes.body.slots.find((s) => s.id === 'slot-concurrency-1');
    if (!slotObj || slotObj.available !== true) {
      throw new Error(`Slot was expected to be available: true after cancel, got: ${JSON.stringify(slotObj)}`);
    }

    // Rebook the slot with a new patient
    const rebookRes = await makeRequest({
      method: 'POST',
      path: '/bookings',
      port,
      body: {
        slot_id: 'slot-concurrency-1',
        name: 'New Patient',
        email: 'newpatient@example.com',
      },
    });

    if (rebookRes.status !== 201) {
      throw new Error(`Expected HTTP 201 on rebook, got ${rebookRes.status}: ${JSON.stringify(rebookRes.body)}`);
    }
    console.log('Rebook succeeded with new booking ID:', rebookRes.body.id);

    // Verify cancelled booking remains retrievable
    const getCancelledRes = await makeRequest({
      method: 'GET',
      path: `/bookings/${initialBookingId}`,
      port,
    });
    if (getCancelledRes.status !== 200 || getCancelledRes.body.status !== 'cancelled') {
      throw new Error(`Cancelled booking not retrievable: ${JSON.stringify(getCancelledRes.body)}`);
    }

    console.log('✓ Test 2 Passed: Successfully cancelled, freed slot, rebooked, and verified cancelled record remains retrievable.');

    // ---------------------------------------------------------
    // TEST 3: CANCEL TWICE
    // ---------------------------------------------------------
    console.log('\n[Test 3] Cancel twice...');
    const secondCancelRes = await makeRequest({
      method: 'DELETE',
      path: `/bookings/${initialBookingId}`,
      port,
    });

    if (secondCancelRes.status !== 409) {
      throw new Error(`Expected HTTP 409 on second cancel, got ${secondCancelRes.status}`);
    }
    if (secondCancelRes.body.error !== 'booking already cancelled') {
      throw new Error(`Expected 'booking already cancelled', got: ${JSON.stringify(secondCancelRes.body)}`);
    }
    console.log('✓ Test 3 Passed: Second cancellation returned HTTP 409 {"error":"booking already cancelled"}.');

    // ---------------------------------------------------------
    // TEST 4: CANCEL NONEXISTENT BOOKING
    // ---------------------------------------------------------
    console.log('\n[Test 4] Cancel nonexistent booking...');
    const nonExistentCancelRes = await makeRequest({
      method: 'DELETE',
      path: '/bookings/non-existent-booking-id-12345',
      port,
    });

    if (nonExistentCancelRes.status !== 404) {
      throw new Error(`Expected HTTP 404 on nonexistent cancel, got ${nonExistentCancelRes.status}`);
    }
    if (nonExistentCancelRes.body.error !== 'booking not found') {
      throw new Error(`Expected 'booking not found', got: ${JSON.stringify(nonExistentCancelRes.body)}`);
    }
    console.log('✓ Test 4 Passed: Nonexistent cancellation returned HTTP 404 {"error":"booking not found"}.');

    // ---------------------------------------------------------
    // TEST 5: CONCURRENT CANCELLATION ATTEMPTS
    // ---------------------------------------------------------
    console.log('\n[Test 5] Concurrent cancellation attempts on the same booking...');
    const currentActiveBookingId = rebookRes.body.id;

    const cancelPromises = [];
    for (let i = 0; i < 5; i++) {
      cancelPromises.push(
        makeRequest({
          method: 'DELETE',
          path: `/bookings/${currentActiveBookingId}`,
          port,
        })
      );
    }

    const cancelResults = await Promise.all(cancelPromises);
    const cancelSuccess = cancelResults.filter((r) => r.status === 200);
    const cancelConflicts = cancelResults.filter((r) => r.status === 409);

    console.log(`Concurrent cancel results: ${cancelSuccess.length} HTTP 200, ${cancelConflicts.length} HTTP 409`);
    if (cancelSuccess.length !== 1) {
      throw new Error(`Expected exactly 1 successful cancel (200), got ${cancelSuccess.length}`);
    }
    if (cancelConflicts.length !== 4) {
      throw new Error(`Expected exactly 4 conflicts (409), got ${cancelConflicts.length}`);
    }
    console.log('✓ Test 5 Passed: Exactly 1 concurrent cancellation succeeded, others received 409.');

    // ---------------------------------------------------------
    // TEST 6: BOOKING DIFFERENT SLOTS SIMULTANEOUSLY
    // ---------------------------------------------------------
    console.log('\n[Test 6] Booking different slots simultaneously...');
    await makeRequest({
      method: 'POST',
      path: '/reset',
      port,
      body: {
        slots: [
          {
            id: 'slot-diff-1',
            provider: 'Dr Alice',
            start: '2026-12-10T10:00:00Z',
            end: '2026-12-10T10:30:00Z',
          },
          {
            id: 'slot-diff-2',
            provider: 'Dr Bob',
            start: '2026-12-10T11:00:00Z',
            end: '2026-12-10T11:30:00Z',
          },
        ],
      },
    });

    const diffResults = await Promise.all([
      makeRequest({
        method: 'POST',
        path: '/bookings',
        port,
        body: {
          slot_id: 'slot-diff-1',
          name: 'Patient Alice',
          email: 'alice@example.com',
        },
      }),
      makeRequest({
        method: 'POST',
        path: '/bookings',
        port,
        body: {
          slot_id: 'slot-diff-2',
          name: 'Patient Bob',
          email: 'bob@example.com',
        },
      }),
    ]);

    if (diffResults[0].status !== 201 || diffResults[1].status !== 201) {
      throw new Error(`Expected both requests to succeed with 201, got ${diffResults[0].status} and ${diffResults[1].status}`);
    }
    console.log('✓ Test 6 Passed: Simultaneous bookings for different slots both succeeded with HTTP 201.');

    console.log('\n=== ALL LEVEL 3 CONCURRENCY & INTEGRITY TESTS PASSED SUCCESSFULLY! ===\n');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error('CONCURRENCY TEST FAILED:', err);
  process.exit(1);
});
