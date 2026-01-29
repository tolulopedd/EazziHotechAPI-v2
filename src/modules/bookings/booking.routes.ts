import { Router } from "express";
import { createBooking, listBookings, arrivalsToday, inHouse } from "./booking.controller";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";

export const bookingRoutes = Router();

bookingRoutes.post("/bookings", requireAuth, requireRole("ADMIN", "MANAGER"), createBooking);

bookingRoutes.get("/bookings", requireAuth, requireRole("ADMIN", "MANAGER", "STAFF"), listBookings);

// ✅ Front desk lists
bookingRoutes.get(
  "/bookings/arrivals/today",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  arrivalsToday
);

bookingRoutes.get(
  "/bookings/inhouse",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  inHouse
);
