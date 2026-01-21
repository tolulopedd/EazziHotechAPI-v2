import { Router } from "express";
import { createHotel } from "./hotel.controller";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";

export const hotelRoutes = Router();

hotelRoutes.post(
  "/hotels",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  createHotel
);
