import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import {
  createPlatformTenant,
  getMyTenant,
  listPlatformTenants,
  updateMyTenant,
  updateMyTenantSubscription,
  updatePlatformTenantSubscription,
} from "./tenant.controller";

export const tenantRoutes = Router();

tenantRoutes.get("/tenant", requireAuth, getMyTenant);
tenantRoutes.patch("/tenant", requireAuth, updateMyTenant);
tenantRoutes.patch("/tenant/subscription", requireAuth, updateMyTenantSubscription);
tenantRoutes.post("/platform/tenants", requireAuth, createPlatformTenant);
tenantRoutes.get("/platform/tenants", requireAuth, listPlatformTenants);
tenantRoutes.patch("/platform/tenants/:tenantId/subscription", requireAuth, updatePlatformTenantSubscription);
