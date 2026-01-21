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




export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(morgan("dev"));



  app.use(tenantMiddleware);

 

  app.use("/api", healthRoutes);
  app.use("/api", authRoutes);
  app.use("/api", hotelRoutes);
  app.use("/api", propertyRoutes);



  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));


  app.use(errorMiddleware);

  return app;
}
