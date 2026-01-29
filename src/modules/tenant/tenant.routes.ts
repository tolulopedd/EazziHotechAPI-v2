import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { getMyTenant, updateMyTenant } from "./tenant.controller";

export const tenantRoutes = Router();

tenantRoutes.get("/tenant", requireAuth, getMyTenant);
tenantRoutes.patch("/tenant", requireAuth, updateMyTenant);
