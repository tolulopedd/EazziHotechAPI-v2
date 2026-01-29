// src/modules/me/me.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { getMe } from "./me.controller";

export const meRoutes = Router();

meRoutes.get("/me", requireAuth, getMe);
