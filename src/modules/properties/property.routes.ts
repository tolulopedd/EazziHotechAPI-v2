import { Router } from "express";
import { createProperty, deleteProperty, listProperties, updateProperty } from "./property.controller";
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

propertyRoutes.patch(
  "/properties/:propertyId",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  updateProperty
);

propertyRoutes.delete(
  "/properties/:propertyId",
  requireAuth,
  requireRole("ADMIN"),
  deleteProperty
);
