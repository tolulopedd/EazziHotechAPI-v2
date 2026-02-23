import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { assertPropertyInScope, resolvePropertyScope, scopedUnitWhere } from "../../common/authz/property-scope";

// prisma folder is at project root (outside src)
import { prismaForTenant } from "../../../prisma/tenantPrisma";

function toOptionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`${field} must be a valid date`, 400, "VALIDATION_ERROR");
  }
  return d;
}

export const createUnit = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const { propertyId } = req.params;
  const propertyScope = await resolvePropertyScope(req);
  assertPropertyInScope(propertyScope, propertyId);

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
  const propertyScope = await resolvePropertyScope(req);
  assertPropertyInScope(propertyScope, propertyId);

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

export const listUnits = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);

  // Optional filters
  const propertyId = req.query.propertyId ? String(req.query.propertyId) : undefined;

  const units = await db.raw.unit.findMany({
    where: {
      tenantId,
      ...scopedUnitWhere(propertyScope),
      ...(propertyId ? { propertyId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ units });
});

export const updateUnit = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const { unitId } = req.params;
  if (!unitId) throw new AppError("unitId is required", 400, "VALIDATION_ERROR");

  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);

  const unit = await db.raw.unit.findFirst({
    where: { id: unitId, tenantId, ...scopedUnitWhere(propertyScope) },
    select: { id: true, propertyId: true },
  });
  if (!unit) throw new AppError("Unit not found", 404, "UNIT_NOT_FOUND");

  const {
    name,
    type,
    capacity,
    basePrice,
    discountType,
    discountValue,
    discountStart,
    discountEnd,
    discountLabel,
  } = req.body ?? {};

  if (type !== undefined && type !== "ROOM" && type !== "APARTMENT") {
    throw new AppError("type must be ROOM or APARTMENT", 400, "VALIDATION_ERROR");
  }
  if (name !== undefined && (!String(name).trim() || typeof name !== "string")) {
    throw new AppError("name must be a non-empty string", 400, "VALIDATION_ERROR");
  }

  const cap =
    capacity === undefined || capacity === null
      ? undefined
      : Number.isFinite(Number(capacity))
      ? Number(capacity)
      : NaN;
  if (cap !== undefined && (!Number.isFinite(cap) || cap < 1)) {
    throw new AppError("capacity must be a number >= 1", 400, "VALIDATION_ERROR");
  }

  if (basePrice !== undefined && basePrice !== null && typeof basePrice !== "string") {
    throw new AppError("basePrice must be a string like \"45000.00\"", 400, "VALIDATION_ERROR");
  }
  if (discountType !== undefined && discountType !== null && discountType !== "PERCENT" && discountType !== "FIXED_PRICE") {
    throw new AppError("discountType must be PERCENT or FIXED_PRICE", 400, "VALIDATION_ERROR");
  }
  if (discountValue !== undefined && discountValue !== null && typeof discountValue !== "string") {
    throw new AppError("discountValue must be a string like \"10.00\"", 400, "VALIDATION_ERROR");
  }

  const startDate = toOptionalDate(discountStart, "discountStart");
  const endDate = toOptionalDate(discountEnd, "discountEnd");
  if (startDate && endDate && endDate < startDate) {
    throw new AppError("discountEnd must be after discountStart", 400, "VALIDATION_ERROR");
  }

  // Any missing discount field clears the discount config.
  const shouldClearDiscount =
    discountType === null ||
    discountValue === null ||
    discountStart === null ||
    discountEnd === null;

  const updated = await db.raw.unit.update({
    where: { id: unitId },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(cap !== undefined ? { capacity: cap } : {}),
      ...(basePrice !== undefined ? { basePrice: basePrice ? String(basePrice) : null } : {}),
      ...(shouldClearDiscount
        ? {
            discountType: null,
            discountValue: null,
            discountStart: null,
            discountEnd: null,
            discountLabel: null,
          }
        : {
            ...(discountType !== undefined ? { discountType } : {}),
            ...(discountValue !== undefined ? { discountValue: discountValue ? String(discountValue) : null } : {}),
            ...(discountStart !== undefined ? { discountStart: startDate } : {}),
            ...(discountEnd !== undefined ? { discountEnd: endDate } : {}),
            ...(discountLabel !== undefined ? { discountLabel: discountLabel ? String(discountLabel).trim() : null } : {}),
          }),
    },
  });

  res.json({ unit: updated });
});

export const deleteUnit = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const { propertyId, unitId } = req.params;
  if (!propertyId || !unitId) {
    throw new AppError("propertyId and unitId are required", 400, "VALIDATION_ERROR");
  }

  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);
  assertPropertyInScope(propertyScope, propertyId);

  const unit = await db.raw.unit.findFirst({
    where: { id: unitId, propertyId, tenantId },
    select: { id: true },
  });
  if (!unit) throw new AppError("Unit not found", 404, "UNIT_NOT_FOUND");

  const bookingCount = await db.raw.booking.count({
    where: { tenantId, unitId },
  });
  if (bookingCount > 0) {
    throw new AppError("Cannot delete unit with existing bookings", 409, "UNIT_IN_USE");
  }

  await db.raw.unit.delete({ where: { id: unitId } });
  res.status(204).send();
});
