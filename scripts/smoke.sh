#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-test-api-key}"

fail() {
  echo "FAILED: $1"
  return 1 2>/dev/null || (kill -s TERM $$ 2>/dev/null || true)
}

echo "=== Running Level 1, Level 2, and Level 3 Smoke Tests against $BASE_URL ==="

# 0a. Authentication Check: Missing API Key
echo -n "0a. Testing request with missing API key (401 check) ... "
NO_AUTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/slots")
NO_AUTH_STATUS=$(echo "$NO_AUTH_RESPONSE" | tail -n 1)
NO_AUTH_BODY=$(echo "$NO_AUTH_RESPONSE" | head -n -1)

if [ "$NO_AUTH_STATUS" -ne 401 ] || ! echo "$NO_AUTH_BODY" | grep -q "unauthorized"; then
  fail "Status: $NO_AUTH_STATUS, Body: $NO_AUTH_BODY"
fi
echo "PASSED (401)"

# 0b. Authentication Check: Invalid API Key
echo -n "0b. Testing request with invalid API key (401 check) ... "
BAD_AUTH_RESPONSE=$(curl -s -w "\n%{http_code}" -H "X-API-Key: invalid-key" "$BASE_URL/slots")
BAD_AUTH_STATUS=$(echo "$BAD_AUTH_RESPONSE" | tail -n 1)
BAD_AUTH_BODY=$(echo "$BAD_AUTH_RESPONSE" | head -n -1)

if [ "$BAD_AUTH_STATUS" -ne 401 ] || ! echo "$BAD_AUTH_BODY" | grep -q "unauthorized"; then
  fail "Status: $BAD_AUTH_STATUS, Body: $BAD_AUTH_BODY"
fi
echo "PASSED (401)"

# 1. Reset slots
echo -n "1. Testing POST /reset with valid key ... "
RESET_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/reset" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "slots": [
      {
        "id": "smoke-s1",
        "provider": "Dr Ade",
        "start": "2026-12-10T09:00:00Z",
        "end": "2026-12-10T09:30:00Z"
      },
      {
        "id": "smoke-s2",
        "provider": "Dr Chioma",
        "start": "2026-12-10T10:00:00Z",
        "end": "2026-12-10T10:30:00Z"
      },
      {
        "id": "smoke-past",
        "provider": "Dr Past",
        "start": "2020-01-01T10:00:00Z",
        "end": "2020-01-01T10:30:00Z"
      }
    ]
  }')

RESET_STATUS=$(echo "$RESET_RESPONSE" | tail -n 1)
if [ "$RESET_STATUS" -ne 200 ]; then
  fail "Status: $RESET_STATUS"
fi
echo "PASSED (200)"

# 2. Get all slots
echo -n "2. Testing GET /slots ... "
SLOTS_RESPONSE=$(curl -s -w "\n%{http_code}" -H "X-API-Key: $API_KEY" "$BASE_URL/slots")
SLOTS_STATUS=$(echo "$SLOTS_RESPONSE" | tail -n 1)
SLOTS_BODY=$(echo "$SLOTS_RESPONSE" | head -n -1)

if [ "$SLOTS_STATUS" -ne 200 ] || ! echo "$SLOTS_BODY" | grep -q "smoke-s1"; then
  fail "Status: $SLOTS_STATUS, Body: $SLOTS_BODY"
fi
echo "PASSED (200)"

# 3. Provider filter
echo -n "3. Testing GET /slots?provider=Dr Ade ... "
FILTER_RESPONSE=$(curl -s -w "\n%{http_code}" -H "X-API-Key: $API_KEY" "$BASE_URL/slots?provider=Dr%20Ade")
FILTER_STATUS=$(echo "$FILTER_RESPONSE" | tail -n 1)
FILTER_BODY=$(echo "$FILTER_RESPONSE" | head -n -1)

if [ "$FILTER_STATUS" -ne 200 ] || ! echo "$FILTER_BODY" | grep -q "smoke-s1" || echo "$FILTER_BODY" | grep -q "smoke-s2"; then
  fail "Status: $FILTER_STATUS, Body: $FILTER_BODY"
fi
echo "PASSED (200)"

# 4a. Booking Validation: Missing fields
echo -n "4a. Testing POST /bookings with missing fields (400 check) ... "
MISSING_FIELD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/bookings" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"slot_id": "smoke-s1", "name": "Ada Obi"}')
MISSING_FIELD_STATUS=$(echo "$MISSING_FIELD_RESPONSE" | tail -n 1)
if [ "$MISSING_FIELD_STATUS" -ne 400 ]; then
  fail "Status: $MISSING_FIELD_STATUS"
fi
echo "PASSED (400)"

# 4b. Booking Validation: Invalid email
echo -n "4b. Testing POST /bookings with invalid email (400 check) ... "
BAD_EMAIL_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/bookings" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"slot_id": "smoke-s1", "name": "Ada Obi", "email": "invalid-email"}')
BAD_EMAIL_STATUS=$(echo "$BAD_EMAIL_RESPONSE" | tail -n 1)
if [ "$BAD_EMAIL_STATUS" -ne 400 ]; then
  fail "Status: $BAD_EMAIL_STATUS"
fi
echo "PASSED (400)"

# 4c. Booking Validation: Past slot
echo -n "4c. Testing POST /bookings with past slot (400 check) ... "
PAST_SLOT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/bookings" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"slot_id": "smoke-past", "name": "Ada Obi", "email": "ada@example.com"}')
PAST_SLOT_STATUS=$(echo "$PAST_SLOT_RESPONSE" | tail -n 1)
PAST_SLOT_BODY=$(echo "$PAST_SLOT_RESPONSE" | head -n -1)
if [ "$PAST_SLOT_STATUS" -ne 400 ] || ! echo "$PAST_SLOT_BODY" | grep -q "slot already started"; then
  fail "Status: $PAST_SLOT_STATUS, Body: $PAST_SLOT_BODY"
fi
echo "PASSED (400)"

# 4d. Create valid booking
echo -n "4d. Testing valid POST /bookings ... "
BOOKING_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/bookings" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "slot_id": "smoke-s1",
    "name": "   Ada Obi   ",
    "email": "   ADA@Example.COM   "
  }')

BOOKING_STATUS=$(echo "$BOOKING_RESPONSE" | tail -n 1)
BOOKING_BODY=$(echo "$BOOKING_RESPONSE" | head -n -1)

if [ "$BOOKING_STATUS" -ne 201 ] || ! echo "$BOOKING_BODY" | grep -q '"email":"ada@example.com"'; then
  fail "Status: $BOOKING_STATUS, Body: $BOOKING_BODY"
fi
BOOKING_ID=$(echo "$BOOKING_BODY" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "PASSED (201, ID: $BOOKING_ID, normalized email)"

# 5. Prevent Double Booking (Level 3 Check)
echo -n "5. Testing double booking prevention (409 check) ... "
DOUBLE_BOOK_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/bookings" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "slot_id": "smoke-s1",
    "name": "Another Patient",
    "email": "another@example.com"
  }')
DOUBLE_BOOK_STATUS=$(echo "$DOUBLE_BOOK_RESPONSE" | tail -n 1)
DOUBLE_BOOK_BODY=$(echo "$DOUBLE_BOOK_RESPONSE" | head -n -1)

if [ "$DOUBLE_BOOK_STATUS" -ne 409 ] || ! echo "$DOUBLE_BOOK_BODY" | grep -q "slot already booked"; then
  fail "Status: $DOUBLE_BOOK_STATUS, Body: $DOUBLE_BOOK_BODY"
fi
echo "PASSED (409)"

# 6. Check slot availability became false
echo -n "6. Verifying slot availability after booking ... "
SLOTS_AFTER_RESPONSE=$(curl -s -H "X-API-Key: $API_KEY" "$BASE_URL/slots")
if ! echo "$SLOTS_AFTER_RESPONSE" | grep -q '"available":false'; then
  fail "Slot smoke-s1 not marked unavailable ($SLOTS_AFTER_RESPONSE)"
fi
echo "PASSED"

# 7. Get booking by ID
echo -n "7. Testing GET /bookings/:id ... "
GET_BOOKING_RESPONSE=$(curl -s -w "\n%{http_code}" -H "X-API-Key: $API_KEY" "$BASE_URL/bookings/$BOOKING_ID")
GET_BOOKING_STATUS=$(echo "$GET_BOOKING_RESPONSE" | tail -n 1)
GET_BOOKING_BODY=$(echo "$GET_BOOKING_RESPONSE" | head -n -1)

if [ "$GET_BOOKING_STATUS" -ne 200 ] || ! echo "$GET_BOOKING_BODY" | grep -q "$BOOKING_ID"; then
  fail "Status: $GET_BOOKING_STATUS, Body: $GET_BOOKING_BODY"
fi
echo "PASSED (200)"

# 8. Cancel Booking (Level 3 DELETE /bookings/:id)
echo -n "8. Testing DELETE /bookings/:id ... "
CANCEL_RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE -H "X-API-Key: $API_KEY" "$BASE_URL/bookings/$BOOKING_ID")
CANCEL_STATUS=$(echo "$CANCEL_RESPONSE" | tail -n 1)
CANCEL_BODY=$(echo "$CANCEL_RESPONSE" | head -n -1)

if [ "$CANCEL_STATUS" -ne 200 ] || ! echo "$CANCEL_BODY" | grep -q '"status":"cancelled"'; then
  fail "Status: $CANCEL_STATUS, Body: $CANCEL_BODY"
fi
echo "PASSED (200, status: cancelled)"

# 9. Cancel already cancelled booking (409 check)
echo -n "9. Testing double cancellation (409 check) ... "
CANCEL_AGAIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE -H "X-API-Key: $API_KEY" "$BASE_URL/bookings/$BOOKING_ID")
CANCEL_AGAIN_STATUS=$(echo "$CANCEL_AGAIN_RESPONSE" | tail -n 1)
CANCEL_AGAIN_BODY=$(echo "$CANCEL_AGAIN_RESPONSE" | head -n -1)

if [ "$CANCEL_AGAIN_STATUS" -ne 409 ] || ! echo "$CANCEL_AGAIN_BODY" | grep -q "booking already cancelled"; then
  fail "Status: $CANCEL_AGAIN_STATUS, Body: $CANCEL_AGAIN_BODY"
fi
echo "PASSED (409)"

# 10. Re-check slot availability after cancel (must be available: true)
echo -n "10. Verifying slot availability after cancellation ... "
SLOTS_AFTER_CANCEL=$(curl -s -H "X-API-Key: $API_KEY" "$BASE_URL/slots")
if ! echo "$SLOTS_AFTER_CANCEL" | grep -q '"available":true'; then
  fail "Slot smoke-s1 not marked available after cancellation ($SLOTS_AFTER_CANCEL)"
fi
echo "PASSED"

# 11. Rebook slot after cancellation (must succeed with 201)
echo -n "11. Testing rebooking after cancellation ... "
REBOOK_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/bookings" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "slot_id": "smoke-s1",
    "name": "Rebooking Patient",
    "email": "rebook@example.com"
  }')
REBOOK_STATUS=$(echo "$REBOOK_RESPONSE" | tail -n 1)
REBOOK_BODY=$(echo "$REBOOK_RESPONSE" | head -n -1)

if [ "$REBOOK_STATUS" -ne 201 ]; then
  fail "Status: $REBOOK_STATUS, Body: $REBOOK_BODY"
fi
echo "PASSED (201)"

# 12. Cancel non-existent booking (404 check)
echo -n "12. Testing DELETE /bookings/nonexistent (404 check) ... "
NOT_FOUND_CANCEL=$(curl -s -w "\n%{http_code}" -X DELETE -H "X-API-Key: $API_KEY" "$BASE_URL/bookings/nonexistent-id")
NOT_FOUND_CANCEL_STATUS=$(echo "$NOT_FOUND_CANCEL" | tail -n 1)
NOT_FOUND_CANCEL_BODY=$(echo "$NOT_FOUND_CANCEL" | head -n -1)

if [ "$NOT_FOUND_CANCEL_STATUS" -ne 404 ] || ! echo "$NOT_FOUND_CANCEL_BODY" | grep -q "booking not found"; then
  fail "Status: $NOT_FOUND_CANCEL_STATUS, Body: $NOT_FOUND_CANCEL_BODY"
fi
echo "PASSED (404)"

# 13. Cancelled booking still retrievable
echo -n "13. Testing GET on cancelled booking ... "
GET_CANCELLED=$(curl -s -w "\n%{http_code}" -H "X-API-Key: $API_KEY" "$BASE_URL/bookings/$BOOKING_ID")
GET_CANCELLED_STATUS=$(echo "$GET_CANCELLED" | tail -n 1)
GET_CANCELLED_BODY=$(echo "$GET_CANCELLED" | head -n -1)

if [ "$GET_CANCELLED_STATUS" -ne 200 ] || ! echo "$GET_CANCELLED_BODY" | grep -q '"status":"cancelled"'; then
  fail "Status: $GET_CANCELLED_STATUS, Body: $GET_CANCELLED_BODY"
fi
echo "PASSED (200)"

echo "=== All Level 1, Level 2, and Level 3 Smoke Tests Passed Successfully ==="
