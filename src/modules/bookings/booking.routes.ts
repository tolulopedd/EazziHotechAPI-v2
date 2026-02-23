// src/modules/bookings/booking.routes.ts
import { Router } from "express";

import {
  confirmGuestPhotoUpload,
  createBooking,
  deleteBooking,
  listBookings,
  arrivalsToday,
  arrivalsWeek,
  inHouse,
  presignGuestPhotoUpload,
  checkInBooking,
  updateBooking,
  uploadGuestPhoto,
  recordBookingPayment,
} from "./booking.controller";

import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import { imageUpload } from "../../middleware/image.middleware";

export const bookingRoutes = Router();

/* =========================
   BOOKINGS
========================= */

bookingRoutes.post(
  "/bookings",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  createBooking
);

bookingRoutes.get(
  "/bookings",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  listBookings
);

bookingRoutes.patch(
  "/bookings/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  updateBooking
);

bookingRoutes.delete(
  "/bookings/:id",
  requireAuth,
  requireRole("ADMIN"),
  deleteBooking
);

/* =========================
   ARRIVALS & IN-HOUSE
========================= */

bookingRoutes.get(
  "/bookings/arrivals/today",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  arrivalsToday
);

bookingRoutes.get(
  "/bookings/arrivals/week",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  arrivalsWeek
);

bookingRoutes.get(
  "/bookings/inhouse",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  inHouse
);

/* =========================
   CHECK-IN
========================= */

bookingRoutes.post(
  "/bookings/:id/check-in",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  checkInBooking
);

/**
 * ✅ Upload guest photo (demo: local disk, prod: S3 later)
 * Expects multipart/form-data
 * Field name: "file"
 * Max size: 300KB
 */
bookingRoutes.post(
  "/bookings/:id/guest-photo/presign",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  presignGuestPhotoUpload
);

bookingRoutes.post(
  "/bookings/:id/guest-photo/confirm",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  confirmGuestPhotoUpload
);

bookingRoutes.post(
  "/bookings/:id/guest-photo",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  imageUpload({ maxSizeKb: 300 }).single("file"),
  uploadGuestPhoto
);

/* =========================
   PAYMENTS (Booking-level)
========================= */

bookingRoutes.post(
  "/bookings/:id/payments",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  recordBookingPayment
);

/**
 * ❌ Removed:
 * bookingRoutes.get("/payments/pending", ..., pendingPayments)
 * Keep /api/payments/pending ONLY in paymentRoutes to avoid conflicts.
 */
