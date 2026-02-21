import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path"; // ✅ NEW

import { tenantMiddleware } from "./middleware/tenant.middleware";
import { errorMiddleware } from "./middleware/error.middleware";
import { requestContextMiddleware } from "./middleware/request-context.middleware";

import { healthRoutes } from "./modules/health/health.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { hotelRoutes } from "./modules/hotels/hotel.routes";
import { propertyRoutes } from "./modules/properties/property.routes";
import { unitRoutes } from "./modules/units/unit.routes";
import { bookingRoutes } from "./modules/bookings/booking.routes";
import { paymentRoutes } from "./modules/payments/payment.routes";
import { checkRoutes } from "./modules/check/check.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { tenantRoutes } from "./modules/tenant/tenant.routes";
import { reportsRoutes } from "./modules/reports/reports.routes";
import { guestRoutes } from "./modules/guests/guest.routes";
import { leadsRoutes } from "./modules/leads/leads.routes";
import { newsRoutes } from "./modules/news/news.routes";


// ✅ NEW: public routes (tenant discovery)
import { publicRoutes } from "./modules/public/public.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(requestContextMiddleware);
  app.use(cors());
  app.use(express.json());
  app.use(morgan("dev"));

  /**
   * ✅ Serve local uploads (DEMO)
   * Must be BEFORE tenantMiddleware because <img> requests cannot send x-tenant-id.
   */
app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "uploads"), {
    fallthrough: false, // ✅ KEY: do NOT continue to tenantMiddleware if missing
  })
);

  /**
   * ✅ Public endpoints (NO tenant header required)
   * - Tenant discovery/selection
   * - Auth (login/register) should not require x-tenant-id
   */
  app.use("/api/public", publicRoutes);
  app.use("/api", authRoutes);
  app.use("/api", healthRoutes);

  // ✅ Tenant middleware applies to protected API routes only
  app.use(tenantMiddleware);

  app.use("/api", dashboardRoutes);
  app.use("/api", usersRoutes);
  app.use("/api", tenantRoutes);

  app.use("/api", hotelRoutes);
  app.use("/api", propertyRoutes);
  app.use("/api", unitRoutes);
  app.use("/api", bookingRoutes);
  app.use("/api", paymentRoutes);
  app.use("/api", checkRoutes);
  app.use("/api", reportsRoutes);
  app.use("/api", guestRoutes);
  app.use("/api", leadsRoutes);
  app.use("/api", newsRoutes);

  app.use((_req, res) =>
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Route not found" },
    })
  );

  app.use(errorMiddleware);

  return app;
}
