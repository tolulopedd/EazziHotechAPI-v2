import { Router } from "express";
import { checkIn, checkOut } from "./check.controller";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";

export const checkRoutes = Router();

checkRoutes.post("/bookings/:bookingId/check-in", requireAuth, requireRole("ADMIN", "MANAGER", "STAFF"), checkIn);
checkRoutes.post("/bookings/:bookingId/check-out", requireAuth, requireRole("ADMIN", "MANAGER", "STAFF"), checkOut);
