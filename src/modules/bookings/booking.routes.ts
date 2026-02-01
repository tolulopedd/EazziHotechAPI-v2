import { Router } from "express";
import {
  createBooking,
  listBookings,
  arrivalsToday,
  arrivalsWeek,     // ✅ NEW
  inHouse,
  checkInBooking,   // ✅ NEW / UPDATED
  pendingPayments,
   recordBookingPayment, 
} from "./booking.controller";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";

export const bookingRoutes = Router();

bookingRoutes.post(
  "/bookings",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  createBooking
);

bookingRoutes.get(
  "/bookings",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  listBookings
);

// ✅ Front desk lists
bookingRoutes.get(
  "/bookings/arrivals/today",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  arrivalsToday
);

// ✅ NEW: Arrivals for the week
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

// ✅ NEW: Check-in with extra guest info
bookingRoutes.post(
  "/bookings/:id/check-in",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  checkInBooking
);

bookingRoutes.post(
  "/bookings/:id/payments",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  recordBookingPayment
);

bookingRoutes.get(
  "/payments/pending",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  pendingPayments
);

