#!/usr/bin/env bash
set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "=== Smoke Testing Level 1 API at ${BASE_URL} ==="

echo "1. Health Check:"
curl -f -s "${BASE_URL}/health"
echo -e "\n"

echo "2. Reset Database with Slots (POST /reset):"
RESET_RESP=$(curl -f -s -X POST "${BASE_URL}/reset" \
  -H "Content-Type: application/json" \
  -d '{
    "slots": [
      {
        "id": "s-past",
        "provider": "Dr Ade",
        "start": "2020-01-01T09:00:00Z",
        "end": "2020-01-01T09:30:00Z"
      },
      {
        "id": "s1",
        "provider": "Dr Ade",
        "start": "2026-12-10T09:00:00Z",
        "end": "2026-12-10T09:30:00Z"
      },
      {
        "id": "s2",
        "provider": "Dr Bello",
        "start": "2026-12-10T10:00:00Z",
        "end": "2026-12-10T10:30:00Z"
      }
    ]
  }')
echo "${RESET_RESP}"
echo -e "\n"

echo "3. List All Slots sorted by start ascending (GET /slots):"
curl -f -s "${BASE_URL}/slots"
echo -e "\n"

echo "4. Filter Slots by Provider (GET /slots?provider=Dr%20Ade):"
curl -f -s "${BASE_URL}/slots?provider=Dr%20Ade"
echo -e "\n"

echo "5. Create Booking on Unknown Slot (Expect 404):"
curl -s -X POST "${BASE_URL}/bookings" \
  -H "Content-Type: application/json" \
  -d '{"slot_id": "nonexistent", "name": "Ada Obi", "email": "ada@example.com"}'
echo -e "\n"

echo "6. Create Booking on Slot s1 (POST /bookings):"
BOOKING_RESP=$(curl -f -s -X POST "${BASE_URL}/bookings" \
  -H "Content-Type: application/json" \
  -d '{"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"}')
echo "${BOOKING_RESP}"
echo -e "\n"

BOOKING_ID=$(echo "${BOOKING_RESP}" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "Generated Booking ID: ${BOOKING_ID}"

echo "7. Verify Slot s1 is now unavailable (GET /slots):"
curl -f -s "${BASE_URL}/slots"
echo -e "\n"

echo "8. Retrieve Booking by ID (GET /bookings/${BOOKING_ID}):"
curl -f -s "${BASE_URL}/bookings/${BOOKING_ID}"
echo -e "\n"

echo "9. Retrieve Missing Booking (Expect 404):"
curl -s "${BASE_URL}/bookings/nonexistent-id"
echo -e "\n"

echo "=== Level 1 Smoke Test Complete ==="
