import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";

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

  const properties = await db.property.findMany({
    orderBy: { createdAt: "desc" },
  });

  res.json({ properties });
});
