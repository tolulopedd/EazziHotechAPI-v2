import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";

import {
  bookingsPaymentsReport,
  exportBookingsPaymentsDailyCsv,
  exportBookingsPaymentsOutstandingCsv,
} from "./reports.controller";

export const reportsRoutes = Router();

/**
 * 📊 Bookings + Payments Report (JSON)
 * GET /api/reports/bookings-payments
 * Query:
 *  - from=YYYY-MM-DD
 *  - to=YYYY-MM-DD
 *  - propertyId?
 *  - unitId?
 *  - includeCancelled=true|false
 */
reportsRoutes.get(
  "/reports/bookings-payments",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  bookingsPaymentsReport
);

/**
 * 📥 Daily Bookings + Payments (CSV)
 * GET /api/reports/bookings-payments/daily.csv
 */
reportsRoutes.get(
  "/reports/bookings-payments/daily.csv",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  exportBookingsPaymentsDailyCsv
);

/**
 * 📥 Outstanding Bookings (CSV)
 * GET /api/reports/bookings-payments/outstanding.csv
 */
reportsRoutes.get(
  "/reports/bookings-payments/outstanding.csv",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  exportBookingsPaymentsOutstandingCsv
);
