import { Router } from "express";
import {
  createManualPayment,
  confirmPayment,
  deletePendingPayment,
  listPayments,
  listOutstandingBookings,   // ✅ NEW
} from "./payment.controller";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";

export const paymentRoutes = Router();

/**
 * ✅ Outstanding balances (Bookings with remaining balance)
 * GET /api/payments/pending
 */
paymentRoutes.get(
  "/payments/pending",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"), // STAFF can view outstanding
  listOutstandingBookings
);

/**
 * Create manual payment
 * POST /api/bookings/:bookingId/payments
 */
paymentRoutes.post(
  "/bookings/:bookingId/payments",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  createManualPayment
);

/**
 * Confirm payment
 * POST /api/payments/:paymentId/confirm
 */
paymentRoutes.post(
  "/payments/:paymentId/confirm",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  confirmPayment
);

/**
 * List confirmed/all payments
 * GET /api/payments
 */
paymentRoutes.get(
  "/payments",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  listPayments
);

paymentRoutes.delete(
  "/payments/:paymentId",
  requireAuth,
  requireRole("ADMIN"),
  deletePendingPayment
);
