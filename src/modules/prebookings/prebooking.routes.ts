import { Router } from "express";

import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import {
  cancelPreBooking,
  convertPreBooking,
  createPreBooking,
  listPreBookings,
} from "./prebooking.controller";

export const preBookingRoutes = Router();

preBookingRoutes.post(
  "/prebookings",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  createPreBooking
);

preBookingRoutes.get(
  "/prebookings",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  listPreBookings
);

preBookingRoutes.post(
  "/prebookings/:id/convert",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  convertPreBooking
);

preBookingRoutes.patch(
  "/prebookings/:id/cancel",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  cancelPreBooking
);
