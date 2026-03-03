-- Performance indexes for high-frequency filters:
-- Booking: tenant/status/date-window + unit availability overlap checks
-- Payment: tenant/status/date + booking settlement
-- BookingCharge: open/typed charge lookups
-- CheckEvent: early-checkout report scans

CREATE INDEX IF NOT EXISTS "Booking_tenantId_status_checkIn_checkOut_idx"
  ON "Booking" ("tenantId", "status", "checkIn", "checkOut");

CREATE INDEX IF NOT EXISTS "Booking_tenantId_checkIn_idx"
  ON "Booking" ("tenantId", "checkIn");

CREATE INDEX IF NOT EXISTS "Booking_tenantId_checkOut_idx"
  ON "Booking" ("tenantId", "checkOut");

CREATE INDEX IF NOT EXISTS "Booking_unitId_status_checkIn_checkOut_idx"
  ON "Booking" ("unitId", "status", "checkIn", "checkOut");

CREATE INDEX IF NOT EXISTS "Payment_tenantId_status_paidAt_idx"
  ON "Payment" ("tenantId", "status", "paidAt");

CREATE INDEX IF NOT EXISTS "Payment_tenantId_bookingId_status_idx"
  ON "Payment" ("tenantId", "bookingId", "status");

CREATE INDEX IF NOT EXISTS "Payment_tenantId_createdAt_idx"
  ON "Payment" ("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "BookingCharge_tenantId_bookingId_status_idx"
  ON "BookingCharge" ("tenantId", "bookingId", "status");

CREATE INDEX IF NOT EXISTS "BookingCharge_tenantId_status_type_createdAt_idx"
  ON "BookingCharge" ("tenantId", "status", "type", "createdAt");

CREATE INDEX IF NOT EXISTS "CheckEvent_tenantId_type_earlyCheckout_capturedAt_idx"
  ON "CheckEvent" ("tenantId", "type", "earlyCheckout", "capturedAt");
