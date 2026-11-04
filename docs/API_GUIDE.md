# Clinic Booking API Integration & Usage Guide

A comprehensive, developer-friendly integration guide for interacting with the **Clinic Booking API**. This guide covers core architecture, authentication, the complete booking lifecycle, idempotency, keyset pagination, code examples across multiple environments, and deployment best practices.

Interactive API exploration is available via the public [Swagger UI Documentation](https://koyaclinic.onrender.com/docs).

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Prerequisites & Access](#2-prerequisites--access)
3. [Authentication](#3-authentication)
4. [Step-by-Step Booking Workflow](#4-step-by-step-booking-workflow)
5. [Endpoint Reference](#5-endpoint-reference)
   - [GET /health](#get-health)
   - [POST /reset](#post-reset)
   - [GET /slots](#get-slots)
   - [POST /bookings](#post-bookings)
   - [GET /bookings](#get-bookings)
   - [GET /bookings/:id](#get-bookingsid)
   - [DELETE /bookings/:id](#delete-bookingsid)
6. [Code Examples](#6-code-examples)
   - [cURL](#curl-examples)
   - [JavaScript (Fetch / Browser / Node.js)](#javascript-fetch-examples)
   - [Node.js (Axios / Backend Service)](#nodejs-backend-service-example)
7. [Error Handling & Status Codes](#7-error-handling--status-codes)
8. [Booking Integrity, Concurrency & Reliability](#8-booking-integrity-concurrency--reliability)
9. [Testing & Troubleshooting](#9-testing--troubleshooting)
10. [Deployment & Production Usage](#10-deployment--production-usage)

---

## 1. Introduction

### What the Clinic Booking API Does
The **Clinic Booking API** provides a backend engine for healthcare providers, clinical staff, and patients to discover available appointment slots, book appointments safely under concurrent traffic, query booking history using keyset pagination, and cancel bookings with automatic slot release.

### Main Capabilities
- **Slot Discovery & Scheduling**: Real-time availability calculation where slots are dynamically marked unavailable if an active confirmed booking exists.
- **Provider Filtering**: Filter available appointments by specific healthcare professionals.
- **Concurrency & Double-Booking Prevention**: Database-enforced atomic reservation using PostgreSQL partial unique indexes and transaction isolation to prevent double bookings during simultaneous requests.
- **Level 4 Idempotent Bookings**: Support for optional `Idempotency-Key` headers backed by PostgreSQL advisory transaction locks (`pg_advisory_xact_lock`) and stable payload hashing to guarantee that network retries never create duplicate bookings.
- **Keyset Booking Pagination**: Fast cursor-based pagination for patient appointment history sorted oldest first (`created_at ASC, id ASC`).
- **Audit-Safe Cancellations**: Bookings transition to `cancelled` without record deletion, preserving historical records while immediately freeing the slot for new patient reservations.

### Architecture Overview
The application is built on Express.js and Prisma ORM connected to PostgreSQL. The architecture strictly separates HTTP transport, validation middleware, business logic services, and atomic database persistence.

```
┌────────────────────────────────────────────────────────┐
│                   Client Application                   │
│   (Web Frontend, Mobile Client, or External Service)   │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS + X-API-Key
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Express.js Server                    │
│  ├── CORS & JSON Middleware                            │
│  ├── Swagger UI (/docs) & OpenAPI (/openapi.json)      │
│  ├── Health Check (/health)                            │
│  ├── Client Proxy (/api/*)                             │
│  └── Assessment Routes (/reset, /slots, /bookings)     │
│       ├── Auth Middleware (X-API-Key validation)       │
│       └── Validation Middleware (payload & sanitize)   │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Service Layer                        │
│  ├── slot.service.js (queries, availability filter)    │
│  └── booking.service.js (idempotency, atomic locks)    │
└───────────────────────────┬────────────────────────────┘
                            │ Prisma ORM
                            ▼
┌────────────────────────────────────────────────────────┐
│             PostgreSQL Database (Neon)                 │
│  ├── slots (id, provider, start, end)                  │
│  ├── bookings (id, slot_id, name, email, status)       │
│  │    └── UNIQUE INDEX on slot_id WHERE confirmed      │
│  └── idempotency_keys (key, request_hash, body)        │
└────────────────────────────────────────────────────────┘
```

### Technology Stack
- **Runtime**: Node.js (v18+)
- **Web Framework**: Express.js (v4.21+)
- **Database ORM**: Prisma ORM (v6.4+)
- **Database Engine**: PostgreSQL (Neon Serverless PostgreSQL)
- **API Documentation**: OpenAPI 3.0 / Swagger UI
- **Testing**: Jest, Supertest

### Live Base URLs
- **Production Service URL**: `https://koyaclinic.onrender.com`
- **Interactive Swagger UI**: `https://koyaclinic.onrender.com/docs`
- **OpenAPI JSON Specification**: `https://koyaclinic.onrender.com/openapi.json`
- **Local Development URL**: `http://localhost:3000`

---

## 2. Prerequisites & Access

To integrate with the Clinic Booking API, your development environment requires:
1. **HTTP Client**: cURL, Postman, Insomnia, or any programming language HTTP client (`fetch`, `axios`, `got`, etc.).
2. **API Access Key**: A valid secret key passed in the `X-API-Key` HTTP header.
3. **Network Access**: Outbound HTTPS connectivity to `https://koyaclinic.onrender.com`.

### Required Headers
All requests to protected endpoints (`/reset`, `/slots`, `/bookings`, `/bookings/:id`) must include:
```http
X-API-Key: <YOUR_API_KEY>
Content-Type: application/json
```

Requests to `POST /bookings` may optionally include an idempotency header:
```http
Idempotency-Key: <UNIQUE_CLIENT_GENERATED_KEY>
```

---

## 3. Authentication

The Clinic Booking API uses header-based API key authentication. Every incoming request to protected routes is evaluated by `src/middleware/auth.middleware.js`.

### How Authentication Works
- You must supply the header `X-API-Key: YOUR_API_KEY`.
- If the header is omitted or does not match the server's configured `process.env.API_KEY`, the server halts execution immediately and returns:
  ```json
  HTTP/1.1 401 Unauthorized
  Content-Type: application/json

  {
    "error": "unauthorized"
  }
  ```

### Secure Credential Storage & Security Best Practices
- **Never expose your private API key in client-side code**: Browser scripts, mobile binary bundles, and public repositories must never contain your raw `API_KEY`.
- **Use Server-Side Proxies**: When building a browser frontend, route requests through your own backend or same-origin proxy (such as the implemented `/api/*` endpoints in this repository) where the secret key is securely attached on the server.
- **Environment Variables**: Store your key in `.env` files locally and within secure secrets management consoles in staging and production (e.g., Render Environment Variables, AWS Secrets Manager, GitHub Secrets).

---

## 4. Step-by-Step Booking Workflow

A standard client integration follows this lifecycle:

```
1. Discover Slots          GET /slots?provider=Dr%20Ade
         │                 Response: Array of slots with availability status
         ▼
2. Select Slot             Identify an available slot (available: true)
         │                 Note slot ID and future start timestamp
         ▼
3. Submit Booking          POST /bookings
         │                 Headers: X-API-Key, Idempotency-Key: <uuid>
         │                 Body: { slot_id, name, email }
         ▼
4. Receive Confirmation    HTTP 201 Created
         │                 Response: { id, slot_id, name, email, status: "confirmed", ... }
         ▼
5. Inquire Booking State   GET /bookings/:id
         │                 Response: Current booking details
         ▼
6. Inquire Patient History GET /bookings?email=patient@example.com&limit=10
         │                 Response: Paginated bookings list with next_cursor
         ▼
7. Cancel If Requested     DELETE /bookings/:id
                           Response: Status changed to "cancelled", slot freed
```

### Detailed Workflow Steps:
1. **Retrieve Available Appointment Slots**:
   Call `GET /slots`. Inspect the returned array. Each slot includes an `available` boolean. If a confirmed booking already exists for a slot, `available` evaluates to `false`.
2. **Identify a Suitable Slot**:
   Choose a slot where `available === true` and `start` is in the future.
3. **Submit a Booking Request**:
   Send a `POST /bookings` request with the chosen `slot_id`, patient `name`, and patient `email`. To protect against network drops or rapid accidental clicks, generate and include a unique `Idempotency-Key` header (e.g. UUIDv4).
4. **Receive Booking Confirmation**:
   A successful reservation yields `HTTP 201 Created` with a unique UUID `id`, `status: "confirmed"`, and the normalized email.
5. **Retrieve an Existing Booking**:
   Retrieve individual reservation records anytime using `GET /bookings/{id}`.
6. **Cancel a Booking When Requested**:
   Call `DELETE /bookings/{id}`. The booking status transitions to `cancelled` with `HTTP 200 OK`. The slot immediately becomes available for other patients.
7. **Query Booking History with Pagination**:
   Query all historical bookings (confirmed and cancelled) for an email address with `GET /bookings?email=patient@example.com&limit=10`. Use the returned `next_cursor` to iterate through subsequent pages.

---

## 5. Endpoint Reference

### GET /health
Checks service health and availability.

- **URL**: `/health`
- **Method**: `GET`
- **Authentication**: None (Public)
- **Headers**: None
- **Parameters**: None
- **Success Response**:
  - **Code**: `200 OK`
  - **Body**:
    ```json
    {
      "ok": true
    }
    ```

---

### POST /reset
Atomically clears all bookings, slots, and idempotency records, and resets the slot schedule with the provided list.

- **URL**: `/reset`
- **Method**: `POST`
- **Authentication**: `X-API-Key`
- **Headers**:
  - `X-API-Key`: `<API_KEY>`
  - `Content-Type`: `application/json`
- **Request Body**:
  ```json
  {
    "slots": [
      {
        "id": "s1",
        "provider": "Dr Ade",
        "start": "2026-12-10T09:00:00Z",
        "end": "2026-12-10T09:30:00Z"
      },
      {
        "id": "s2",
        "provider": "Dr Chioma",
        "start": "2026-12-10T10:00:00Z",
        "end": "2026-12-10T10:30:00Z"
      }
    ]
  }
  ```
- **Success Response**:
  - **Code**: `200 OK`
  - **Body**: *(empty)*
- **Error Responses**:
  - `401 Unauthorized`: `{"error":"unauthorized"}`

---

### GET /slots
Retrieves all slots ordered by start time ascending (`start ASC`).

- **URL**: `/slots`
- **Method**: `GET`
- **Authentication**: `X-API-Key`
- **Headers**:
  - `X-API-Key`: `<API_KEY>`
- **Query Parameters**:
  - `provider` *(optional)*: String. Filter by exact provider name (e.g. `?provider=Dr%20Ade`).
- **Success Response**:
  - **Code**: `200 OK`
  - **Body**:
    ```json
    {
      "slots": [
        {
          "id": "s1",
          "provider": "Dr Ade",
          "start": "2026-12-10T09:00:00.000Z",
          "end": "2026-12-10T09:30:00.000Z",
          "available": true
        },
        {
          "id": "s2",
          "provider": "Dr Chioma",
          "start": "2026-12-10T10:00:00.000Z",
          "end": "2026-12-10T10:30:00.000Z",
          "available": false
        }
      ]
    }
    ```
- **Error Responses**:
  - `401 Unauthorized`: `{"error":"unauthorized"}`

---

### POST /bookings
Creates a confirmed booking for a slot.

- **URL**: `/bookings`
- **Method**: `POST`
- **Authentication**: `X-API-Key`
- **Headers**:
  - `X-API-Key`: `<API_KEY>`
  - `Content-Type`: `application/json`
  - `Idempotency-Key` *(optional)*: `<CLIENT_GENERATED_KEY>`
- **Request Body**:
  ```json
  {
    "slot_id": "s1",
    "name": "Ada Lovelace",
    "email": "ada@example.com"
  }
  ```
- **Validation Rules**:
  - `slot_id`: Required non-empty string. Must match an existing slot.
  - `name`: Required non-empty string. Automatically trimmed.
  - `email`: Required valid email address format. Automatically trimmed and converted to lowercase.
  - Slot must not have already started (`slot.start > now`).
  - Slot must not have an active confirmed booking.
- **Success Response**:
  - **Code**: `201 Created`
  - **Body**:
    ```json
    {
      "id": "e4a2c5a0-53be-4395-9bf6-b489be74bb7c",
      "slot_id": "s1",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "status": "confirmed",
      "created_at": "2026-11-04T12:00:00.000Z"
    }
    ```
- **Error Responses**:
  - `400 Bad Request`:
    - Missing or non-string fields: `{"error":"invalid or missing fields"}`
    - Empty strings after trim: `{"error":"fields cannot be empty"}`
    - Invalid email regex: `{"error":"invalid email format"}`
    - Past or current slot: `{"error":"slot already started"}`
  - `401 Unauthorized`: `{"error":"unauthorized"}`
  - `404 Not Found`: `{"error":"slot not found"}`
  - `409 Conflict`: `{"error":"slot already booked"}`
  - `422 Unprocessable Entity`: `{"error":"idempotency key reused with a different body"}`

---

### GET /bookings
Lists bookings for a specific patient email using keyset pagination.

- **URL**: `/bookings`
- **Method**: `GET`
- **Authentication**: `X-API-Key`
- **Headers**:
  - `X-API-Key`: `<API_KEY>`
- **Query Parameters**:
  - `email` *(required)*: Case-insensitive email filter. Missing or empty string returns 400.
  - `limit` *(optional)*: Integer between `1` and `50`. Defaults to `10`.
  - `cursor` *(optional)*: Opaque base64url keyset cursor from preceding page.
- **Success Response**:
  - **Code**: `200 OK`
  - **Body**:
    ```json
    {
      "bookings": [
        {
          "id": "e4a2c5a0-53be-4395-9bf6-b489be74bb7c",
          "slot_id": "s1",
          "name": "Ada Lovelace",
          "email": "ada@example.com",
          "status": "confirmed",
          "created_at": "2026-11-04T12:00:00.000Z"
        }
      ],
      "next_cursor": null
    }
    ```
- **Error Responses**:
  - `400 Bad Request`:
    - Missing email: `{"error":"email is required"}`
    - Invalid limit: `{"error":"invalid limit"}`
    - Malformed cursor: `{"error":"invalid cursor"}`
  - `401 Unauthorized`: `{"error":"unauthorized"}`

---

### GET /bookings/:id
Retrieves an individual booking by ID.

- **URL**: `/bookings/:id`
- **Method**: `GET`
- **Authentication**: `X-API-Key`
- **Headers**:
  - `X-API-Key`: `<API_KEY>`
- **Path Parameters**:
  - `id`: UUID of the booking.
- **Success Response**:
  - **Code**: `200 OK`
  - **Body**:
    ```json
    {
      "id": "e4a2c5a0-53be-4395-9bf6-b489be74bb7c",
      "slot_id": "s1",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "status": "confirmed",
      "created_at": "2026-11-04T12:00:00.000Z"
    }
    ```
- **Error Responses**:
  - `401 Unauthorized`: `{"error":"unauthorized"}`
  - `404 Not Found`: `{"error":"booking not found"}`

---

### DELETE /bookings/:id
Cancels an active booking reservation.

- **URL**: `/bookings/:id`
- **Method**: `DELETE`
- **Authentication**: `X-API-Key`
- **Headers**:
  - `X-API-Key`: `<API_KEY>`
- **Path Parameters**:
  - `id`: UUID of the booking to cancel.
- **Success Response**:
  - **Code**: `200 OK`
  - **Body**:
    ```json
    {
      "id": "e4a2c5a0-53be-4395-9bf6-b489be74bb7c",
      "slot_id": "s1",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "status": "cancelled",
      "created_at": "2026-11-04T12:00:00.000Z"
    }
    ```
- **Error Responses**:
  - `401 Unauthorized`: `{"error":"unauthorized"}`
  - `404 Not Found`: `{"error":"booking not found"}`
  - `409 Conflict`: `{"error":"booking already cancelled"}`

---

## 7. Code Examples

### cURL Examples

#### 1. Discover Slots
```bash
curl -X GET "https://koyaclinic.onrender.com/slots?provider=Dr%20Ade" \
  -H "X-API-Key: YOUR_API_KEY"
```

#### 2. Submit Idempotent Booking
```bash
curl -X POST "https://koyaclinic.onrender.com/bookings" \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: req_c9402e1b-410a-4298-b80c" \
  -d '{
    "slot_id": "s1",
    "name": "Ada Lovelace",
    "email": "ada@example.com"
  }'
```

#### 3. Retrieve Booking by ID
```bash
curl -X GET "https://koyaclinic.onrender.com/bookings/e4a2c5a0-53be-4395-9bf6-b489be74bb7c" \
  -H "X-API-Key: YOUR_API_KEY"
```

#### 4. List Patient Bookings (Paginated)
```bash
curl -X GET "https://koyaclinic.onrender.com/bookings?email=ada@example.com&limit=10" \
  -H "X-API-Key: YOUR_API_KEY"
```

#### 5. Cancel Booking
```bash
curl -X DELETE "https://koyaclinic.onrender.com/bookings/e4a2c5a0-53be-4395-9bf6-b489be74bb7c" \
  -H "X-API-Key: YOUR_API_KEY"
```

---

### JavaScript Fetch Examples

```javascript
const BASE_URL = 'https://koyaclinic.onrender.com';
const API_KEY = process.env.API_KEY || 'YOUR_API_KEY';

/**
 * 1. Fetch available appointment slots
 */
async function getAvailableSlots(provider = null) {
  const url = new URL(`${BASE_URL}/slots`);
  if (provider) url.searchParams.set('provider', provider);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': API_KEY,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to fetch slots: ${error.error}`);
  }

  const { slots } = await response.json();
  return slots.filter((slot) => slot.available);
}

/**
 * 2. Submit an appointment booking with idempotency protection
 */
async function createBooking(slotId, name, email) {
  const idempotencyKey = `web-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const response = await fetch(`${BASE_URL}/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      slot_id: slotId,
      name,
      email,
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(`Booking failed (${response.status}): ${body.error}`);
  }

  return body;
}

/**
 * 3. Keyset Pagination helper to retrieve all bookings for an email
 */
async function fetchAllBookingsForEmail(email) {
  let allBookings = [];
  let cursor = null;

  do {
    const url = new URL(`${BASE_URL}/bookings`);
    url.searchParams.set('email', email);
    url.searchParams.set('limit', '50');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, {
      headers: { 'X-API-Key': API_KEY },
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }

    const data = await res.json();
    allBookings.push(...data.bookings);
    cursor = data.next_cursor;
  } while (cursor);

  return allBookings;
}
```

---

### Node.js Backend Service Example

```javascript
const axios = require('axios');

class ClinicBookingClient {
  constructor(apiKey, baseURL = 'https://koyaclinic.onrender.com') {
    this.client = axios.create({
      baseURL,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  async listAvailableSlots(provider) {
    const params = provider ? { provider } : {};
    const { data } = await this.client.get('/slots', { params });
    return data.slots;
  }

  async bookAppointment(slotId, name, email, idempotencyKey) {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
    const { data } = await this.client.post(
      '/bookings',
      { slot_id: slotId, name, email },
      { headers }
    );
    return data;
  }

  async cancelAppointment(bookingId) {
    const { data } = await this.client.delete(`/bookings/${bookingId}`);
    return data;
  }
}

module.exports = ClinicBookingClient;
```

---

## 7. Error Handling & Status Codes

All error responses from the Clinic Booking API follow the unified OpenAPI specification format:
```json
{
  "error": "human-readable description"
}
```

| HTTP Status | Error Scenario | API Error Message | Client Action |
|---|---|---|---|
| `400 Bad Request` | Missing slot_id, name, or email | `"invalid or missing fields"` | Verify all required properties are present. |
| `400 Bad Request` | Whitespace-only values | `"fields cannot be empty"` | Provide trimmed, non-blank strings. |
| `400 Bad Request` | Invalid email format | `"invalid email format"` | Validate email with standard email regex before submitting. |
| `400 Bad Request` | Slot start time in the past | `"slot already started"` | Refresh slots list and choose an upcoming appointment. |
| `400 Bad Request` | Missing email in `GET /bookings` | `"email is required"` | Supply a valid `?email=...` query parameter. |
| `400 Bad Request` | Limit < 1, > 50, or non-numeric | `"invalid limit"` | Supply an integer between 1 and 50. |
| `400 Bad Request` | Corrupted pagination cursor | `"invalid cursor"` | Pass unaltered `next_cursor` strings from previous responses. |
| `401 Unauthorized` | Missing or incorrect API key | `"unauthorized"` | Check the `X-API-Key` header and environment secret. |
| `404 Not Found` | Unknown slot identifier | `"slot not found"` | Ensure slot ID exists by querying `GET /slots`. |
| `404 Not Found` | Non-existent booking ID | `"booking not found"` | Verify the booking ID. |
| `409 Conflict` | Slot already booked by another user | `"slot already booked"` | Inform patient that the slot was reserved; prompt to select another. |
| `409 Conflict` | Booking already cancelled | `"booking already cancelled"` | Booking is already inactive. No further action needed. |
| `422 Unprocessable Entity` | Same Idempotency-Key sent with different body | `"idempotency key reused with a different body"` | Generate a distinct key for each new booking attempt. |
| `500 Internal Server Error` | Database or unhandled error | `"Internal server error"` | Retry after backoff; inspect server logs. |

---

## 8. Booking Integrity, Concurrency & Reliability

The Clinic Booking API guarantees data integrity under heavy concurrent workloads:

### 1. Database-Enforced Partial Unique Index
To guarantee that race conditions can never produce two active reservations for the same slot, the PostgreSQL database enforces:
```sql
CREATE UNIQUE INDEX one_confirmed_booking_per_slot
ON "bookings"("slot_id")
WHERE status = 'confirmed';
```
If two concurrent requests attempt to reserve the same slot at the exact same millisecond:
- The database permits exactly one transaction to commit.
- The competing transaction encounters a unique constraint violation (`P2002`).
- The application catches this cleanly and returns `HTTP 409 {"error":"slot already booked"}`.

### 2. Level 4 Idempotency Engine
To prevent duplicate charges or double bookings caused by network timeouts or repeated button clicks:
- Clients provide an `Idempotency-Key` header.
- The server acquires a PostgreSQL transaction advisory lock:
  ```sql
  SELECT pg_advisory_xact_lock(hashtext(key));
  ```
  This serializes concurrent requests presenting the same key across any number of clustered backend instances.
- Computes a deterministic SHA-256 hash using alphabetized JSON key serialization.
- If the key exists with the **identical hash**: Returns the original status code and body without modifying database state.
- If the key exists with a **different hash**: Returns `HTTP 422 {"error":"idempotency key reused with a different body"}`.
- Successful `201 Created` responses and relevant `4xx` validation errors (`400`, `404`, `409`) are cached. Transient failures (such as `401` or `500`) are never cached.

### 3. Keyset Pagination
Instead of inefficient and drifting `OFFSET` pagination, `GET /bookings` implements keyset pagination:
- Records are sorted strictly by `created_at ASC, id ASC`.
- The `cursor` is a URL-safe base64 string containing `{ createdAt, id }`.
- When fetching the next page, queries filter with `WHERE (created_at > cursor.createdAt) OR (created_at = cursor.createdAt AND id > cursor.id)`.
- Guarantees predictable $O(\log n)$ performance regardless of page depth and immune to record insertions/deletions mid-pagination.

---

## 9. Testing & Troubleshooting

### Using Postman or Insomnia
1. Create a new Collection named `Clinic Booking API`.
2. Add a Collection-level Header:
   - Key: `X-API-Key`
   - Value: `{{API_KEY}}`
3. Set Collection Variable `baseUrl` to `https://koyaclinic.onrender.com`.
4. Import the OpenAPI specification directly from `https://koyaclinic.onrender.com/openapi.json` to generate all requests and documentation automatically.

### Common Configuration Mistakes
1. **Case-Sensitive Header Issues**:
   Headers are case-insensitive in HTTP/2, but ensure proxy servers preserve `X-API-Key` and `Idempotency-Key`.
2. **Missing Content-Type**:
   When submitting `POST /bookings` or `POST /reset`, always include `Content-Type: application/json`.
3. **Invalid Past Timestamp Booking**:
   Booking attempts on slots whose `start` time has elapsed will be rejected with `HTTP 400 {"error":"slot already started"}`. Ensure test slots have dates in the future.
4. **Reusing Idempotency Keys with Modified Payloads**:
   Changing any character in `slot_id`, `name`, or `email` while reusing an existing `Idempotency-Key` will trigger `HTTP 422`. Always generate a fresh key for a new booking intent.

---

## 10. Deployment & Production Usage

### Production Base URL & HTTPS
- **URL**: `https://koyaclinic.onrender.com`
- All communications are strictly encrypted over **HTTPS / TLS 1.3**. Unencrypted HTTP requests are automatically upgraded.

### Environment Configuration
The service requires the following environment variables:

| Variable | Description | Production Example |
|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string with SSL enabled | `postgresql://user:pass@ep-cool-pooler.region.neon.tech/neondb?sslmode=require` |
| `API_KEY` | Secret token required for `X-API-Key` header authentication | `sec_prod_koya_9831f0...` |
| `PORT` | Web server listening port | `3000` (assigned dynamically by Render) |
| `NODE_ENV` | Environment identifier | `production` |

### Database Persistence & Scaling
- **Managed Database**: Deployed on Neon Serverless PostgreSQL with connection pooling.
- **Stateless Web Tier**: The Node.js application is entirely stateless. Sessions, idempotency records, and slot reservations reside in the database, enabling seamless multi-instance horizontal scaling on Render.

---

## Interactive Documentation
For a live, interactive UI where you can authenticate and test all endpoints directly in the browser, visit:
**[https://koyaclinic.onrender.com/docs](https://koyaclinic.onrender.com/docs)**
