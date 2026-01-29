import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { getDashboard } from "./dashboard.controller";
import { tenantMiddleware } from "../../middleware/tenant.middleware";

const router = Router();

/**
 * IMPORTANT:
 * In app.ts you mount dashboard BEFORE app.use(tenantMiddleware),
 * so DO NOT put tenantMiddleware here.
 *
 * Your requireAuth already checks tenant mismatch ONLY if req.tenantId exists,
 * but at this point req.tenantId isn't set yet.
 *
 * So the client must send tenantId in token OR you should move dashboard below tenantMiddleware.
 * (See note below.)
 */

router.get("/dashboard", tenantMiddleware, requireAuth, getDashboard);

export const dashboardRoutes = router;
