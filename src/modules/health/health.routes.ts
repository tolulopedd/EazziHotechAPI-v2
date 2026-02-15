import { Router } from "express";
import { prisma } from "../../prisma/client";

export const healthRoutes = Router();

healthRoutes.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    service: "eazzihotech-api",
    requestId: req.requestId ?? null,
    tenantId: req.tenantId ?? null,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get("/ready", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      ok: true,
      status: "ready",
      service: "eazzihotech-api",
      requestId: req.requestId ?? null,
      checks: { database: "up" },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      status: "not_ready",
      service: "eazzihotech-api",
      requestId: req.requestId ?? null,
      checks: { database: "down" },
      timestamp: new Date().toISOString(),
    });
  }
});
