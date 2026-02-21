import { Router } from "express";
import { createLead, getPublicNewsBySlug, getTenantBySlug, listPublicNews, listRecentTenants, listTenants } from "./public.controller";

export const publicRoutes = Router();

// Search tenants by name/slug (for tenant selection screen)
publicRoutes.get("/tenants", listTenants);
publicRoutes.get("/tenants/recent", listRecentTenants);
publicRoutes.get("/news", listPublicNews);
publicRoutes.get("/news/:slug", getPublicNewsBySlug);

// Resolve a tenant by exact slug (fast path)
publicRoutes.get("/tenants/by-slug/:slug", getTenantBySlug);
publicRoutes.post("/leads", createLead);
