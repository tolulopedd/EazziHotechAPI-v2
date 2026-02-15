import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { getLeadById, listLeads, updateLead } from "./leads.controller";

export const leadsRoutes = Router();

leadsRoutes.get("/leads", requireAuth, listLeads);
leadsRoutes.get("/leads/:id", requireAuth, getLeadById);
leadsRoutes.patch("/leads/:id", requireAuth, updateLead);
