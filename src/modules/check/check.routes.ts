import { Router } from "express";
import {
  addBookingVisitor,
  addOverstayCharge,
  checkIn,
  checkOut,
  checkoutBookingVisitor,
  listBookingVisitors,
  updateBookingVisitor,
} from "./check.controller";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";

export const checkRoutes = Router();

checkRoutes.post(
  "/bookings/:bookingId/check-in",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  checkIn
);

checkRoutes.post(
  "/bookings/:bookingId/check-out",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  checkOut
);

checkRoutes.post(
  "/bookings/:bookingId/overstay-charge",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  addOverstayCharge
);

checkRoutes.get(
  "/bookings/:bookingId/visitors",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  listBookingVisitors
);

checkRoutes.post(
  "/bookings/:bookingId/visitors",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  addBookingVisitor
);

checkRoutes.patch(
  "/bookings/:bookingId/visitors/:visitorId",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  updateBookingVisitor
);

checkRoutes.patch(
  "/bookings/:bookingId/visitors/:visitorId/checkout",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  checkoutBookingVisitor
);
