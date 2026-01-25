import type { Request, Response, NextFunction } from "express";
import { AppError } from "../common/errors/AppError";
import { prisma } from "../prisma/client";



export async function tenantMiddleware(req: Request, _res: Response, next: NextFunction) {
const tenantId = req.header("x-tenant-id")?.trim();


  if (!tenantId) {
    return next(new AppError("Missing x-tenant-id header", 400, "TENANT_REQUIRED"));
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

  if (!tenant) {
    return next(new AppError("Invalid tenant", 401, "TENANT_INVALID"));
  }

  if (tenant.status !== "ACTIVE") {
    return next(new AppError("Tenant inactive", 403, "TENANT_INACTIVE"));
  }

  req.tenantId = tenantId;
  return next();
}
