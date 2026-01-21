import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { tenantMiddleware } from "./middleware/tenant.middleware";
import { errorMiddleware } from "./middleware/error.middleware";
import { healthRoutes } from "./modules/health/health.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(morgan("dev"));


  app.use(tenantMiddleware);

  app.use("/api", healthRoutes);

  app.use(errorMiddleware);

  return app;
}
