import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { createLead, getLeadById, importHotelsNgProspects, listLeads, previewLeadIntroductionEmail, sendLeadIntroduction, updateLead } from "./leads.controller";

export const leadsRoutes = Router();

leadsRoutes.get("/leads", requireAuth, listLeads);
leadsRoutes.post("/leads", requireAuth, createLead);
leadsRoutes.post("/leads/import/hotels-ng", requireAuth, importHotelsNgProspects);
leadsRoutes.get("/leads/:id/introduction-preview", requireAuth, previewLeadIntroductionEmail);
leadsRoutes.post("/leads/:id/send-introduction", requireAuth, sendLeadIntroduction);
leadsRoutes.get("/leads/:id", requireAuth, getLeadById);
leadsRoutes.patch("/leads/:id", requireAuth, updateLead);
