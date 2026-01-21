import { Router } from "express";

export const healthRoutes = Router();

healthRoutes.get("/health", (req, res) => {
  res.json({
    ok: true,
    tenantId: req.tenantId ?? null,
    timestamp: new Date().toISOString(),
  });
});
