import { Router } from "express";
import { checkIn, checkOut } from "./check.controller";
import { requireAuth } from "../../middleware/auth.middleware";

export const checkRoutes = Router();

checkRoutes.post("/bookings/:bookingId/check-in", requireAuth, checkIn);
checkRoutes.post("/bookings/:bookingId/check-out", requireAuth, checkOut);
