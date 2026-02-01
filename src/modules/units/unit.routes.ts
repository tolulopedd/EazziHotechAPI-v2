import { Router } from "express";
import { createUnit, listUnitsByProperty } from "./unit.controller";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import { listUnits } from "./unit.controller";

export const unitRoutes = Router();

unitRoutes.post(
  "/properties/:propertyId/units",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  createUnit
);

unitRoutes.get("/properties/:propertyId/units", requireAuth, listUnitsByProperty);
unitRoutes.get(
  "/units",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  listUnits
);
