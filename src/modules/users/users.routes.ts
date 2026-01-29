import { Router } from "express";
import { tenantMiddleware } from "../../middleware/tenant.middleware";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import {
  listUsers,
  getUserById,
  createStaffOrManager,
  updateUserById,
  updateMyProfile,
  changeMyPassword,
  disableUser,
  enableUser,
} from "./users.controller";



const router = Router();

/**
 * Tenant + Auth required for everything here
 */
router.use(tenantMiddleware, requireAuth);

/**
 * ADMIN + MANAGER: user management in their tenant
 */
router.get("/users", requireRole("ADMIN", "MANAGER"), listUsers);
router.get("/users/:id", requireRole("ADMIN", "MANAGER"), getUserById);
router.post("/users", requireRole("ADMIN", "MANAGER"), createStaffOrManager);
router.patch("/users/:id", requireRole("ADMIN", "MANAGER"), updateUserById);
router.post("/users/:id/disable", requireRole("ADMIN", "MANAGER"), disableUser);
router.post("/users/:id/enable", requireRole("ADMIN", "MANAGER"), enableUser);


/**
 * STAFF: only update own profile & password
 */
router.patch("/me", updateMyProfile);
router.patch("/me/password", changeMyPassword);

export const usersRoutes = router;
