# Clinic Booking API

Backend API for Task 1 of the Koya Academy technical assessment.

Official Specification: [https://koyaacademy.com/assessment-api](https://koyaacademy.com/assessment-api)

---

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database ORM**: Prisma ORM
- **Database**: PostgreSQL (Neon Serverless)
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Testing**: Jest, Supertest
- **Deployment**: Render & Neon
- **Version Control**: Git / GitHub

---

## Project Structure

```
KoyaClinic/
├── prisma/
│   ├── schema.prisma          # Database schema definition
│   └── migrations/            # Versioned SQL migrations
├── public/                    # Frontend client assets
│   ├── index.html             # Clinic booking web UI
│   ├── styles.css             # UI styling
│   └── app.js                 # Frontend interactions & health check
├── src/
│   ├── controllers/           # HTTP request handlers
│   │   ├── booking.controller.js
│   │   ├── health.controller.js
│   │   └── slot.controller.js
│   ├── middleware/            # Error handling, 404, auth, validation
│   │   ├── auth.middleware.js
│   │   ├── bookingValidation.middleware.js
│   │   ├── error.middleware.js
│   │   └── notFound.middleware.js
│   ├── routes/                # Express routing definitions
│   │   ├── booking.routes.js
│   │   ├── health.routes.js
│   │   ├── index.js
│   │   ├── reset.routes.js
│   │   └── slot.routes.js
│   ├── services/              # Business logic (Level 1, Level 2, Level 3, Level 4)
│   │   ├── booking.service.js
│   │   └── slot.service.js
│   ├── utils/                 # Shared helpers, idempotency & pagination utils
│   │   ├── idempotency.util.js
│   │   └── pagination.util.js
│   ├── app.js                 # Express application setup
│   ├── db.js                  # PrismaClient singleton instance
│   └── index.js               # Server startup & shutdown handling
├── scripts/
│   ├── concurrency-test.js    # Concurrency test suite (Level 3)
│   ├── level4-concurrency-test.js # Concurrency test suite (Level 4 Idempotency)
│   └── smoke.sh               # Automated smoke test suite (Levels 1, 2, 3 & 4)
├── tests/                     # Automated test suites
│   ├── health.test.js
│   ├── level1.test.js
│   ├── level2.test.js
│   ├── level3.test.js
│   └── level4.test.js
├── LEVEL2_REPORT.md           # Level 2 Implementation & Test Report
├── LEVEL3_REPORT.md           # Level 3 Implementation & Test Report
├── LEVEL4_REPORT.md           # Level 4 Implementation & Test Report
├── .env.example               # Template environment configuration
├── .gitignore                 # Files excluded from Git tracking
├── package.json
└── README.md
```

---

## Features Implemented

### Level 1: Core Endpoints
- `POST /reset`: Atomically clears previous bookings and replaces all slots with the provided array.
- `GET /slots`: Lists all slots ordered by start time ascending. Supports exact-match filtering via `?provider=...`. Returns `available: false` when booked.
- `POST /bookings`: Books a slot and returns HTTP 201 with confirmed status.
- `GET /bookings/:id`: Retrieves booking by ID or returns HTTP 404 if missing.

### Level 2: Authentication & Validation
- **Authentication**: All assessment endpoints (`POST /reset`, `GET /slots`, `POST /bookings`, `GET /bookings`, `GET /bookings/:id`, `DELETE /bookings/:id`) require the `X-API-Key` header matching `process.env.API_KEY`. Missing or invalid keys return HTTP 401 with `{"error":"unauthorized"}`.
- **Booking Input Validation**: `POST /bookings` validates `slot_id`, `name`, and `email`. All fields must be non-empty strings. Rejects missing fields, invalid data types, or empty strings with HTTP 400.
- **Data Normalization**: Trims whitespace from `name` and `email`. Normalizes `email` to lowercase. Validates email format.
- **Slot Validation**: Checks slot existence in database (returns HTTP 404 `{"error":"slot not found"}` if missing). Checks slot start time (returns HTTP 400 `{"error":"slot already started"}` if the slot has already started or is in the past).
- **Safety**: No records are created when any validation check fails. No database internals or stack traces are leaked to clients.

### Level 3: Concurrency Control & Cancellation
- **Double Booking Prevention**: Enforced via PostgreSQL partial unique index `one_confirmed_booking_per_slot` on `bookings(slot_id)` WHERE `status = 'confirmed'`.
- **Atomic Operations & Conflict Handling**: Concurrent requests are handled safely inside PostgreSQL transactions. When a competing request attempts to book an occupied slot, it catches unique constraint violations and returns HTTP 409 `{"error":"slot already booked"}`.
- **Cancellation (`DELETE /bookings/:id`)**:
  - Authenticated via `X-API-Key`.
  - Atomically marks booking as `cancelled` without deleting record.
  - Returns HTTP 404 `{"error":"booking not found"}` if nonexistent.
  - Returns HTTP 409 `{"error":"booking already cancelled"}` if already cancelled.
  - Returns full cancelled booking object with HTTP 200.
  - Frees slot for future bookings (shows `available: true` in `GET /slots`).
  - Cancelled bookings remain retrievable via `GET /bookings/:id`.

### Level 4: Idempotency & Booking Pagination
- **Idempotency (`POST /bookings` with `Idempotency-Key` header)**:
  - Supports optional `Idempotency-Key` header.
  - Persisted in PostgreSQL using `IdempotencyKey` model: `key` (id), `requestHash`, `statusCode`, `responseBody`, `createdAt`.
  - Computes SHA-256 hash using stable JSON serialization of normalized request payload.
  - Concurrency protected across multi-backend instances using PostgreSQL transaction advisory locks (`SELECT pg_advisory_xact_lock(hashtext(key))`).
  - If key exists with different hash, returns HTTP 422 `{"error":"idempotency key reused with a different body"}`.
  - If key exists with same hash, returns original status code and response body without creating duplicate bookings.
  - Stores successful 201 responses and applicable 4xx responses (400, 404, 409); never stores 401 or 429.
  - Requests without idempotency key follow normal booking flow.
- **Booking Pagination (`GET /bookings`)**:
  - Requires `email` query parameter, case-insensitive match (trimmed and lowercased). Returns HTTP 400 if missing or empty.
  - Returns confirmed and cancelled bookings.
  - Sorted oldest first: `created_at ASC, id ASC`.
  - Keyset pagination with base64url encoded cursor (`created_at` and `id`). Returns `next_cursor: null` on the final page.
  - Limit validation: integer between 1 and 50 (default 10). Rejects invalid limits (0, 51, negative, non-numeric) with HTTP 400 `{"error":"invalid limit"}`.
  - Rejects invalid cursors with HTTP 400 `{"error":"invalid cursor"}`.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string | `postgresql://user:pass@ep-name.region.aws.neon.tech/neondb?sslmode=require` |
| `PORT` | Local server port | `3000` |
| `API_KEY` | Secret key for `X-API-Key` auth | `my-secret-assessment-key` |
| `NODE_ENV` | Environment mode | `development` or `production` |

---

## Local Development & Testing

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Generate Prisma Client**:
   ```bash
   npm run prisma:generate
   ```

3. **Run Automated Jest Tests**:
   ```bash
   npm test
   ```

4. **Run Real PostgreSQL Concurrency Tests**:
   ```bash
   node scripts/concurrency-test.js
   node scripts/level4-concurrency-test.js
   ```

5. **Run Smoke Tests**:
   ```bash
   npm start &
   bash scripts/smoke.sh
   ```

---

## Deployment Guide

### 1. Neon Database Setup
1. Log in to [Neon](https://neon.tech) and create a project/database.
2. Synchronize schema using `npx prisma db push` or apply migrations.
3. Obtain the connection string with `?sslmode=require`.

### 2. Render Web Service Setup
1. Create a new **Web Service** on [Render](https://render.com) linked to your GitHub repository.
2. Set configuration:
   - **Environment**: Node
   - **Build Command**: `npm install && npx prisma generate`
   - **Start Command**: `npm start`
3. Add Environment Variables:
   - `DATABASE_URL`: Your Neon connection string
   - `API_KEY`: Secret string for assessment validation
   - `NODE_ENV`: `production`
4. Deploy the service. Verify the `/health` endpoint once live.
