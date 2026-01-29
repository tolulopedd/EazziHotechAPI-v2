import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { prismaForTenant } from "../../../prisma/tenantPrisma";


export const createHotel = asyncHandler(async (req: Request, res: Response) => {
  const { name, address } = req.body;
  const tenantId = req.tenantId!;
  const user = (req as any).user;

   // ✅ tenant-safe Prisma
  const db = prismaForTenant(tenantId);

  const hotel = await prisma.hotel.create({
    data: {
      name,
      address,
    },
  });

  res.status(201).json({
    hotel,
    createdBy: user.userId,
  });
});
