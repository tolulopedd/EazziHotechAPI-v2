import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";

// prisma folder is at project root (outside src)
import { prismaForTenant } from "../../../prisma/tenantPrisma";

export const createUnit = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const { propertyId } = req.params;

  const db = prismaForTenant(tenantId);

  // Ensure property belongs to this tenant
  const property = await db.property.findById(propertyId);
  if (!property) throw new AppError("Property not found", 404, "PROPERTY_NOT_FOUND");

  const { type, name, capacity, basePrice } = req.body;

  if (!type || (type !== "ROOM" && type !== "APARTMENT")) {
    throw new AppError("type must be ROOM or APARTMENT", 400, "VALIDATION_ERROR");
  }
  if (!name || typeof name !== "string") {
    throw new AppError("name is required", 400, "VALIDATION_ERROR");
  }

  const cap =
    capacity === undefined || capacity === null
      ? 1
      : Number.isFinite(Number(capacity))
      ? Number(capacity)
      : NaN;

  if (!Number.isFinite(cap) || cap < 1) {
    throw new AppError("capacity must be a number >= 1", 400, "VALIDATION_ERROR");
  }

  // basePrice: send as string e.g. "45000.00" (best for Prisma Decimal)
  if (basePrice !== undefined && basePrice !== null && typeof basePrice !== "string") {
    throw new AppError("basePrice must be a string like \"45000.00\"", 400, "VALIDATION_ERROR");
  }

  const unit = await db.unit.create({
    data: {
      propertyId,
      type,
      name,
      capacity: cap,
      basePrice: basePrice ?? null,
    },
  });

  res.status(201).json({ unit });
});

export const listUnitsByProperty = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const { propertyId } = req.params;

  const db = prismaForTenant(tenantId);

  // Ensure property belongs to this tenant
  const property = await db.property.findById(propertyId);
  if (!property) throw new AppError("Property not found", 404, "PROPERTY_NOT_FOUND");

  const units = await db.unit.findMany({
    where: { propertyId },
    orderBy: { createdAt: "desc" },
  });

  res.json({ units });
});
