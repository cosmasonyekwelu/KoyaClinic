-- Create partial unique index on bookings(slot_id) where status is confirmed
CREATE UNIQUE INDEX IF NOT EXISTS "one_confirmed_booking_per_slot" ON "bookings"("slot_id") WHERE status = 'confirmed';
