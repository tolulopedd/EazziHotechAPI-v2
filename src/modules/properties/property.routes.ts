import { Router } from "express";
import { createProperty, listProperties } from "./property.controller";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";

export const propertyRoutes = Router();

propertyRoutes.post(
  "/properties",
  requireAuth,
  requireRole("ADMIN"),
  createProperty
);

propertyRoutes.get("/properties", requireAuth, listProperties);
