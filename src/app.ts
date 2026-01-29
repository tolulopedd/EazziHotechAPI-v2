import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { tenantMiddleware } from "./middleware/tenant.middleware";
import { errorMiddleware } from "./middleware/error.middleware";

import { healthRoutes } from "./modules/health/health.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { hotelRoutes } from "./modules/hotels/hotel.routes";
import { propertyRoutes } from "./modules/properties/property.routes";
import { unitRoutes } from "./modules/units/unit.routes";
import { bookingRoutes } from "./modules/bookings/booking.routes";
import { paymentRoutes } from "./modules/payments/payment.routes";
import { checkRoutes } from "./modules/check/check.routes";
import {dashboardRoutes} from "./modules/dashboard/dashboard.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { tenantRoutes } from "./modules/tenant/tenant.routes";


// ✅ NEW: public routes (tenant discovery)
import { publicRoutes } from "./modules/public/public.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(morgan("dev"));


  /**
   * ✅ Public endpoints (NO tenant header required)
   * - Tenant discovery/selection
   * - Auth (login/register) should not require x-tenant-id
   */
  app.use("/api/public", publicRoutes);
  app.use("/api", authRoutes);

    app.use(tenantMiddleware);

   app.use("/api", dashboardRoutes);
   app.use("/api", usersRoutes);
   app.use("/api", tenantRoutes);
   



  app.use("/api", healthRoutes);
  app.use("/api", hotelRoutes);
  app.use("/api", propertyRoutes);
  app.use("/api", unitRoutes);
  app.use("/api", bookingRoutes);
  app.use("/api", paymentRoutes);
  app.use("/api", checkRoutes);
 

  app.use((_req, res) =>
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Route not found" },
    })
  );

  app.use(errorMiddleware);

  return app;
}
