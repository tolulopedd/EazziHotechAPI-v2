import type { Request, Response, NextFunction } from "express";
import { AppError } from "../common/errors/AppError";
import { prisma } from "../prisma/client";

function daysUntil(dateValue?: Date | null) {
  if (!dateValue) return null;
  const now = new Date();
  const ms = dateValue.getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export async function tenantMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const tenantId = req.header("x-tenant-id")?.trim();

    if (!tenantId) {
      return next(new AppError("Missing x-tenant-id header", 400, "TENANT_REQUIRED"));
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        status: true,
        subscriptionStatus: true,
        currentPeriodEndAt: true,
        graceEndsAt: true,
      },
    });

    if (!tenant) {
      return next(new AppError("Invalid tenant", 401, "TENANT_INVALID"));
    }

    if (tenant.status !== "ACTIVE") {
      return next(
        new AppError("Tenant is suspended. Please renew your subscription.", 403, "TENANT_SUSPENDED", {
          tenantStatus: tenant.status,
          subscriptionStatus: tenant.subscriptionStatus,
          currentPeriodEndAt: tenant.currentPeriodEndAt,
          graceEndsAt: tenant.graceEndsAt,
        })
      );
    }

    (req as any).tenantId = tenantId;
    (req as any).tenantSubscription = {
      subscriptionStatus: tenant.subscriptionStatus,
      currentPeriodEndAt: tenant.currentPeriodEndAt,
      graceEndsAt: tenant.graceEndsAt,
      daysToExpiry: daysUntil(tenant.currentPeriodEndAt),
    };
    return next();
  } catch (err) {
    return next(err);
  }
}
