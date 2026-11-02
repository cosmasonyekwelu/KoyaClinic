# Level 2 Implementation & Test Report

## 1. Overview
This report documents the implementation and verification of **Level 2** of the Koya Academy Clinic Booking API according to the official specification ([https://koyaacademy.com/assessment-api](https://koyaacademy.com/assessment-api)).

---

## 2. Features Implemented

### 2.1 API Key Authentication (`src/middleware/auth.middleware.js`)
- Protects all required assessment endpoints (`POST /reset`, `GET /slots`, `POST /bookings`, `GET /bookings/:id`).
- Checks for request header `X-API-Key`.
- Compares against `process.env.API_KEY`.
- Missing API key: Returns HTTP `401 Unauthorized` with `{"error":"unauthorized"}`.
- Invalid API key: Returns HTTP `401 Unauthorized` with `{"error":"unauthorized"}`.
- Valid API key: Passes execution to the next route handler.
- Public routes (`GET /health`, `GET /`, and static frontend files) remain unauthenticated.

### 2.2 Booking Request Validation & Sanitization (`src/middleware/bookingValidation.middleware.js`)
- Applied to `POST /bookings`.
- Validates presence and types of `slot_id`, `name`, `email`.
- Rejects non-string data types (numbers, booleans, objects, arrays) with HTTP `400`.
- Trims whitespace from `name`, `email`, and `slot_id`.
- Rejects empty strings or whitespace-only inputs with HTTP `400`.
- Normalizes `email` to lowercase.
- Validates email format using standard regex matching. Rejects invalid email formats with HTTP `400`.
- Attaches sanitized/trimmed values to `req.body`.

### 2.3 Slot Validation (`src/services/booking.service.js`)
- After input validation, checks database for the existence of the requested slot.
- Slot missing: Returns HTTP `404 Not Found` with `{"error":"slot not found"}`.
- Slot in the past or already started (`slot.start <= now`): Returns HTTP `400 Bad Request` with `{"error":"slot already started"}`.
- Slot valid and in future: Creates confirmed booking with generated UUID.
- No booking records are created when any validation step fails.

### 2.4 Error Handling (`src/middleware/error.middleware.js`)
- Standardized JSON responses conforming to `{"error":"<message>"}`.
- Zero leakage of database internals or stack traces.

---

## 3. Test Suites & Verification

### 3.1 Automated Jest Tests
Ran `npm test` covering `tests/health.test.js`, `tests/level1.test.js`, and `tests/level2.test.js`.

- Total Test Suites: 3 passed, 3 total
- Total Tests: 27 passed, 27 total
- Coverage includes:
  - Missing API key returns 401
  - Invalid API key returns 401
  - Valid API key grants access
  - Missing fields return 400
  - Empty strings / whitespace return 400
  - Invalid data types return 400
  - Invalid email formats return 400
  - Non-existent slot returns 404
  - Past slot returns 400
  - Valid booking creates record, trims whitespace, and lowercases email
  - Confirmation that invalid requests create 0 records in database
  - Full Level 1 regression tests (reset, list slots, provider filter, slot availability, get booking by id)

### 3.2 Smoke Tests (`scripts/smoke.sh`)
Extended `scripts/smoke.sh` to test:
- 0a: Missing API key (401 check)
- 0b: Invalid API key (401 check)
- 1: POST /reset with valid API key (200 check)
- 2: GET /slots (200 check)
- 3: GET /slots?provider=Dr Ade exact match (200 check)
- 4a: POST /bookings with missing fields (400 check)
- 4b: POST /bookings with invalid email (400 check)
- 4c: POST /bookings with past slot (400 check)
- 4d: POST /bookings with valid payload, trimming & email normalization (201 check)
- 5: Verify slot availability toggles to false after confirmed booking
- 6: GET /bookings/:id (200 check)
- 7: GET /bookings/nonexistent (404 check)
- 8: POST /bookings with unknown slot (404 check)
