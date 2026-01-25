import { Router } from "express";
import { createBooking, listBookings } from "./booking.controller";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";

export const bookingRoutes = Router();

bookingRoutes.post("/bookings", requireAuth, requireRole("ADMIN", "MANAGER"), createBooking);
bookingRoutes.get("/bookings", requireAuth, requireRole("ADMIN", "MANAGER", "STAFF"), listBookings);
