#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "=== Running Smoke Tests against $BASE_URL ==="

# 1. Reset slots
echo -n "1. Testing POST /reset ... "
RESET_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/reset" \
  -H "Content-Type: application/json" \
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
      }
    ]
  }')

RESET_STATUS=$(echo "$RESET_RESPONSE" | tail -n 1)
if [ "$RESET_STATUS" -ne 200 ]; then
  echo "FAILED (Status: $RESET_STATUS)"
  return 1 2>/dev/null || (kill -s TERM $$ 2>/dev/null || true)
fi
echo "PASSED (200)"

# 2. Get all slots
echo -n "2. Testing GET /slots ... "
SLOTS_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/slots")
SLOTS_STATUS=$(echo "$SLOTS_RESPONSE" | tail -n 1)
SLOTS_BODY=$(echo "$SLOTS_RESPONSE" | head -n -1)

if [ "$SLOTS_STATUS" -ne 200 ] || ! echo "$SLOTS_BODY" | grep -q "smoke-s1"; then
  echo "FAILED (Status: $SLOTS_STATUS, Body: $SLOTS_BODY)"
  return 1 2>/dev/null || (kill -s TERM $$ 2>/dev/null || true)
fi
echo "PASSED (200)"

# 3. Provider filter
echo -n "3. Testing GET /slots?provider=Dr Ade ... "
FILTER_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/slots?provider=Dr%20Ade")
FILTER_STATUS=$(echo "$FILTER_RESPONSE" | tail -n 1)
FILTER_BODY=$(echo "$FILTER_RESPONSE" | head -n -1)

if [ "$FILTER_STATUS" -ne 200 ] || ! echo "$FILTER_BODY" | grep -q "smoke-s1" || echo "$FILTER_BODY" | grep -q "smoke-s2"; then
  echo "FAILED (Status: $FILTER_STATUS, Body: $FILTER_BODY)"
  return 1 2>/dev/null || (kill -s TERM $$ 2>/dev/null || true)
fi
echo "PASSED (200)"

# 4. Create booking
echo -n "4. Testing POST /bookings ... "
BOOKING_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/bookings" \
  -H "Content-Type: application/json" \
  -d '{
    "slot_id": "smoke-s1",
    "name": "Ada Obi",
    "email": "ada@example.com"
  }')

BOOKING_STATUS=$(echo "$BOOKING_RESPONSE" | tail -n 1)
BOOKING_BODY=$(echo "$BOOKING_RESPONSE" | head -n -1)

if [ "$BOOKING_STATUS" -ne 201 ] || ! echo "$BOOKING_BODY" | grep -q '"status":"confirmed"'; then
  echo "FAILED (Status: $BOOKING_STATUS, Body: $BOOKING_BODY)"
  return 1 2>/dev/null || (kill -s TERM $$ 2>/dev/null || true)
fi
BOOKING_ID=$(echo "$BOOKING_BODY" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "PASSED (201, ID: $BOOKING_ID)"

# 5. Check slot availability became false
echo -n "5. Verifying slot availability after booking ... "
SLOTS_AFTER_RESPONSE=$(curl -s "$BASE_URL/slots")
if ! echo "$SLOTS_AFTER_RESPONSE" | grep -q '"available":false'; then
  echo "FAILED: Slot smoke-s1 not marked unavailable ($SLOTS_AFTER_RESPONSE)"
  return 1 2>/dev/null || (kill -s TERM $$ 2>/dev/null || true)
fi
echo "PASSED"

# 6. Get booking by ID
echo -n "6. Testing GET /bookings/:id ... "
GET_BOOKING_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/bookings/$BOOKING_ID")
GET_BOOKING_STATUS=$(echo "$GET_BOOKING_RESPONSE" | tail -n 1)
GET_BOOKING_BODY=$(echo "$GET_BOOKING_RESPONSE" | head -n -1)

if [ "$GET_BOOKING_STATUS" -ne 200 ] || ! echo "$GET_BOOKING_BODY" | grep -q "$BOOKING_ID"; then
  echo "FAILED (Status: $GET_BOOKING_STATUS, Body: $GET_BOOKING_BODY)"
  return 1 2>/dev/null || (kill -s TERM $$ 2>/dev/null || true)
fi
echo "PASSED (200)"

# 7. Get non-existent booking
echo -n "7. Testing GET /bookings/nonexistent (404 check) ... "
NOT_FOUND_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/bookings/nonexistent-id")
NOT_FOUND_STATUS=$(echo "$NOT_FOUND_RESPONSE" | tail -n 1)
NOT_FOUND_BODY=$(echo "$NOT_FOUND_RESPONSE" | head -n -1)

if [ "$NOT_FOUND_STATUS" -ne 404 ] || ! echo "$NOT_FOUND_BODY" | grep -q "booking not found"; then
  echo "FAILED (Status: $NOT_FOUND_STATUS, Body: $NOT_FOUND_BODY)"
  return 1 2>/dev/null || (kill -s TERM $$ 2>/dev/null || true)
fi
echo "PASSED (404)"

# 8. Book unknown slot
echo -n "8. Testing POST /bookings with unknown slot (404 check) ... "
UNKNOWN_SLOT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/bookings" \
  -H "Content-Type: application/json" \
  -d '{
    "slot_id": "unknown-slot-999",
    "name": "Ada Obi",
    "email": "ada@example.com"
  }')
UNKNOWN_SLOT_STATUS=$(echo "$UNKNOWN_SLOT_RESPONSE" | tail -n 1)
UNKNOWN_SLOT_BODY=$(echo "$UNKNOWN_SLOT_RESPONSE" | head -n -1)

if [ "$UNKNOWN_SLOT_STATUS" -ne 404 ] || ! echo "$UNKNOWN_SLOT_BODY" | grep -q "slot not found"; then
  echo "FAILED (Status: $UNKNOWN_SLOT_STATUS, Body: $UNKNOWN_SLOT_BODY)"
  return 1 2>/dev/null || (kill -s TERM $$ 2>/dev/null || true)
fi
echo "PASSED (404)"

echo "=== All Level 1 Smoke Tests Passed Successfully ==="
