import { Router } from "express";
import { tenantMiddleware } from "../../middleware/tenant.middleware";
import { register, login } from "./auth.controller";

const router = Router();

// Register/Login require tenant header in your current architecture:
router.post("/auth/register", tenantMiddleware, register);
router.post("/auth/login", tenantMiddleware, login);

export const authRoutes = router;
