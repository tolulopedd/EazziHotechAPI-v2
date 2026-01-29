import { Router } from "express";
import { listTenants, getTenantBySlug } from "./public.controller";

export const publicRoutes = Router();

// Search tenants by name/slug (for tenant selection screen)
publicRoutes.get("/tenants", listTenants);

// Resolve a tenant by exact slug (fast path)
publicRoutes.get("/tenants/by-slug/:slug", getTenantBySlug);
