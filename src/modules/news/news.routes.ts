import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { createNews, deleteNews, importDefaultNews, listNewsAdmin, updateNews } from "./news.controller";

export const newsRoutes = Router();

newsRoutes.get("/news", requireAuth, listNewsAdmin);
newsRoutes.post("/news/import-defaults", requireAuth, importDefaultNews);
newsRoutes.post("/news", requireAuth, createNews);
newsRoutes.patch("/news/:id", requireAuth, updateNews);
newsRoutes.delete("/news/:id", requireAuth, deleteNews);
