import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { resolvePropertyScope, scopedPropertyWhere } from "../../common/authz/property-scope";

// prisma folder is at project root (outside src)
import { prismaForTenant } from "../../../prisma/tenantPrisma";

export const createProperty = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const { name, address, type } = req.body;

  if (!name || typeof name !== "string") {
    throw new AppError("name is required", 400, "VALIDATION_ERROR");
  }

  // type: HOTEL | SHORTLET (optional)
  if (type && type !== "HOTEL" && type !== "SHORTLET") {
    throw new AppError("type must be HOTEL or SHORTLET", 400, "VALIDATION_ERROR");
  }

  const property = await db.property.create({
    data: {
      name,
      address: address ?? null,
      type: type ?? "HOTEL",
    },
  });

  res.status(201).json({ property });
});

export const listProperties = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);

  const properties = await db.property.findMany({
    where: scopedPropertyWhere(propertyScope),
    orderBy: { createdAt: "desc" },
  });

  if (properties.length === 0) {
    return res.json({ properties: [] });
  }

  const propertyIds = properties.map((p) => p.id);

  // Unit totals by property
  const unitCounts = await db.raw.unit.groupBy({
    by: ["propertyId"],
    where: { tenantId, propertyId: { in: propertyIds } },
    _count: { _all: true },
  });
  const unitCountMap = new Map<string, number>(
    unitCounts.map((u: any) => [u.propertyId as string, Number(u._count?._all ?? 0)])
  );

  // Occupied units today by property (distinct unit)
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const occupiedRows = await db.raw.booking.findMany({
    where: {
      tenantId,
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
      checkIn: { lte: endOfToday },
      checkOut: { gt: startOfToday },
      unit: { propertyId: { in: propertyIds } },
    },
    select: { unitId: true, unit: { select: { propertyId: true } } },
    distinct: ["unitId"],
  });

  const occupiedMap = new Map<string, number>();
  for (const row of occupiedRows as any[]) {
    const propertyId = row?.unit?.propertyId as string | undefined;
    if (!propertyId) continue;
    occupiedMap.set(propertyId, (occupiedMap.get(propertyId) ?? 0) + 1);
  }

  // Month revenue by property (confirmed payments this month)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

  const monthlyRevenueByProperty = await Promise.all(
    propertyIds.map(async (propertyId) => {
      const agg = await db.raw.payment.aggregate({
        where: {
          tenantId,
          status: "CONFIRMED",
          confirmedAt: { gte: startOfMonth, lt: startOfNextMonth },
          booking: { unit: { propertyId } },
        },
        _sum: { amount: true },
      });
      return [propertyId, Number(agg._sum.amount ?? 0)] as const;
    })
  );
  const monthlyRevenueMap = new Map<string, number>(monthlyRevenueByProperty);

  const items = properties.map((p: any) => {
    const totalUnits = unitCountMap.get(p.id) ?? 0;
    const occupiedUnits = occupiedMap.get(p.id) ?? 0;
    const occupancy = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 1000) / 10 : 0;
    const monthlyRevenue = monthlyRevenueMap.get(p.id) ?? 0;

    return {
      ...p,
      unitCount: totalUnits,
      totalUnits,
      occupancy,
      monthlyRevenue,
      status: "active",
    };
  });

  res.json({ properties: items });
});
