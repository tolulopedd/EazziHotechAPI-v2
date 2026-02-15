import { Router } from "express";
import { tenantMiddleware } from "../../middleware/tenant.middleware";
import { forgotPassword, login, register, resetPasswordWithToken } from "./auth.controller";

const router = Router();

// Register/Login require tenant header in your current architecture:
router.post("/auth/register", tenantMiddleware, register);
router.post("/auth/login", tenantMiddleware, login);
router.post("/auth/forgot-password", forgotPassword);
router.post("/auth/reset-password", resetPasswordWithToken);

export const authRoutes = router;
