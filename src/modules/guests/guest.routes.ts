// src/modules/guests/guest.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import { createGuest, listGuests, updateGuest, getGuestById } from "./guest.controller";

export const guestRoutes = Router();

// STAFF can search/select guests during booking/checkin
guestRoutes.get(
  "/guests",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  listGuests
);

// Creating guest: allow STAFF too (frontdesk creates guests)
guestRoutes.post(
  "/guests",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  createGuest
);

// ✅ Read guest details (needed for Guest Details modal)
guestRoutes.get(
  "/guests/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  getGuestById
);

// Update guest: allow STAFF too (so frontdesk can correct typos)
guestRoutes.put(
  "/guests/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "STAFF"),
  updateGuest
);