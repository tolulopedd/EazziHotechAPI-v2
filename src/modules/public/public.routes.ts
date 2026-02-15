import { Router } from "express";
import { createLead, getTenantBySlug, listRecentTenants, listTenants } from "./public.controller";

export const publicRoutes = Router();

// Search tenants by name/slug (for tenant selection screen)
publicRoutes.get("/tenants", listTenants);
publicRoutes.get("/tenants/recent", listRecentTenants);

// Resolve a tenant by exact slug (fast path)
publicRoutes.get("/tenants/by-slug/:slug", getTenantBySlug);
publicRoutes.post("/leads", createLead);
