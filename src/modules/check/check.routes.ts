import { Router } from "express";
import {
  addBookingVisitor,
  extendStay,
  addOverstayCharge,
  addServiceCharge,
  exportBookingBillCsv,
  exportBookingBillPdf,
  exportBookingBillXlsx,
  getBookingBillPreview,
  sendBookingBillToGuest,
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
  "/bookings/:bookingId/extend-stay",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  extendStay
);

checkRoutes.post(
  "/bookings/:bookingId/overstay-charge",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  addOverstayCharge
);

checkRoutes.post(
  "/bookings/:bookingId/service-charge",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  addServiceCharge
);

checkRoutes.get(
  "/bookings/:bookingId/bill",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  getBookingBillPreview
);

checkRoutes.get(
  "/bookings/:bookingId/bill.csv",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  exportBookingBillCsv
);

checkRoutes.get(
  "/bookings/:bookingId/bill.pdf",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  exportBookingBillPdf
);

checkRoutes.get(
  "/bookings/:bookingId/bill.xlsx",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  exportBookingBillXlsx
);

checkRoutes.post(
  "/bookings/:bookingId/bill/send",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  sendBookingBillToGuest
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
