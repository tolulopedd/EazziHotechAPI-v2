import { Router } from "express";
import { createManualPayment, confirmPayment } from "./payment.controller";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";

export const paymentRoutes = Router();

paymentRoutes.post(
  "/bookings/:bookingId/payments",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  createManualPayment
);

paymentRoutes.post(
  "/payments/:paymentId/confirm",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  confirmPayment
);
