# Level 4 Implementation & Verification Report

## Overview
Level 4 of the Koya Academy Clinic Booking API implements:
1. **Idempotency** for `POST /bookings` using the optional `Idempotency-Key` header with PostgreSQL persistence, stable JSON serialization SHA-256 hashing, replay safety, mismatch detection (HTTP 422), and multi-backend concurrency protection via PostgreSQL advisory locks.
2. **Booking Pagination** for `GET /bookings` with required email filtering (case-insensitive, trimmed and lowercased), limit validation (1–50, default 10), keyset pagination sorted oldest first (`created_at ASC, id ASC`), and base64url cursor encoding/decoding.

---

## 1. Idempotency Implementation
- **Prisma Model `IdempotencyKey`**:
  ```prisma
  model IdempotencyKey {
    key          String   @id
    requestHash  String   @map("request_hash")
    statusCode   Int      @map("status_code")
    responseBody Json     @map("response_body")
    createdAt    DateTime @default(now()) @map("created_at")

    @@map("idempotency_keys")
  }
  ```
- **Hashing & Stable Serialization**:
  - `src/utils/idempotency.util.js` normalizes booking payload (`slot_id`, `name`, `email` trimmed and lowercased).
  - Serializes keys in alphabetical order to produce deterministic JSON.
  - Computes standard SHA-256 hash.
- **Concurrency & Replay Safety**:
  - `prisma.$transaction` with `SELECT pg_advisory_xact_lock(hashtext(key))` serializes simultaneous requests with the same key across any number of backend instances.
  - If the key exists:
    - Same hash: returns original HTTP status code and response body, without creating a duplicate booking.
    - Different hash: returns `HTTP 422 {"error":"idempotency key reused with a different body"}`.
  - If key does not exist: executes booking creation. Stores successful 201 responses and applicable 4xx responses (400, 404, 409).
  - 401 unauthorized and 429 rate limit responses are never stored.
  - Requests without `Idempotency-Key` follow normal booking workflow.

---

## 2. Booking Pagination (`GET /bookings`)
- **Query Parameters**:
  - `email`: Required. Trimmed and converted to lowercase. Case-insensitive query matches both confirmed and cancelled bookings. Missing or empty email returns `HTTP 400 {"error":"email is required"}`.
  - `limit`: Optional, default 10. Must be integer between 1 and 50. Values such as 0, 51, negative numbers, or non-numeric strings return `HTTP 400 {"error":"invalid limit"}`.
  - `cursor`: Optional. Keyset pagination cursor encoded as base64url containing `created_at` and `id`. Invalid cursors return `HTTP 400 {"error":"invalid cursor"}`.
- **Ordering**:
  - Sorted oldest first: `created_at ASC, id ASC`.
- **Response Format**:
  ```json
  {
    "bookings": [],
    "next_cursor": null
  }
  ```
  - `next_cursor` is null on the final page or when results are empty.

---

## 3. Concurrency Verification (`scripts/level4-concurrency-test.js`)
Executed against real PostgreSQL on Neon:
```
--- Starting Level 4 Concurrency & Integrity Tests ---
Test server running on port 43221

[Test 1] 20 concurrent requests using the SAME Idempotency-Key and SAME body...
Results status codes: 201 count: 20, other count: 0
Unique booking IDs returned across all 20 requests: 1
Database bookings count: 1
✓ Test 1 Passed: Exactly 1 database booking created, all 20 concurrent requests received HTTP 201 with identical booking ID.

[Test 2] Reusing the same key with different body...
✓ Test 2 Passed: Key reused with different body returned HTTP 422.

=== ALL LEVEL 4 CONCURRENCY TESTS PASSED SUCCESSFULLY! ===
```

---

## 4. Automated Jest Test Suite Results (`npm test`)
All suites covering Level 1, Level 2, Level 3, Level 4, and Health endpoints passed with 100% success rate:
```
 PASS tests/level4.test.js (10.98 s)
 PASS tests/level3.test.js
 PASS tests/level1.test.js
 PASS tests/level2.test.js
 PASS tests/health.test.js

Test Suites: 5 passed, 5 total
Tests:       49 passed, 49 total
Snapshots:   0 total
Time:        22.571 s
Ran all test suites.
```

---

## 5. Automated Smoke Test Suite (`bash scripts/smoke.sh`)
```
=== Running Level 1, Level 2, and Level 3 Smoke Tests against http://localhost:3000 ===
0a. Testing request with missing API key (401 check) ... PASSED (401)
0b. Testing request with invalid API key (401 check) ... PASSED (401)
1. Testing POST /reset with valid key ... PASSED (200)
2. Testing GET /slots ... PASSED (200)
3. Testing GET /slots?provider=Dr Ade ... PASSED (200)
4a. Testing POST /bookings with missing fields (400 check) ... PASSED (400)
4b. Testing POST /bookings with invalid email (400 check) ... PASSED (400)
4c. Testing POST /bookings with past slot (400 check) ... PASSED (400)
4d. Testing valid POST /bookings ... PASSED (201, ID: a0b3349e-dc2d-4146-8e1f-bcf91436b717, normalized email)
5. Testing double booking prevention (409 check) ... PASSED (409)
6. Verifying slot availability after booking ... PASSED
7. Testing GET /bookings/:id ... PASSED (200)
8. Testing DELETE /bookings/:id ... PASSED (200, status: cancelled)
9. Testing double cancellation (409 check) ... PASSED (409)
10. Verifying slot availability after cancellation ... PASSED
11. Testing rebooking after cancellation ... PASSED (201)
12. Testing DELETE /bookings/nonexistent (404 check) ... PASSED (404)
13. Testing GET on cancelled booking ... PASSED (200)
=== All Level 1, Level 2, and Level 3 Smoke Tests Passed Successfully ===
14. Testing Level 4 Idempotency-Key replay ... PASSED (201, Replayed ID matched: 05a04a2e-345b-44fe-9f61-9680f20b8712)
15. Testing Level 4 Idempotency-Key reused with different body (422 check) ... PASSED (422)
16. Testing Level 4 GET /bookings pagination ... PASSED (200, Bookings found)
17. Testing Level 4 GET /bookings with invalid limit (400 check) ... PASSED (400)
=== All Level 1, Level 2, Level 3, and Level 4 Smoke Tests Passed Successfully ===
```
