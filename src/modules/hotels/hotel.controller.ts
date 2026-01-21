import type { Request, Response } from "express";
import { prisma } from "../../prisma/client";
import { asyncHandler } from "../../common/utils/asyncHandler";

export const createHotel = asyncHandler(async (req: Request, res: Response) => {
  const { name, address } = req.body;
  const tenantId = req.tenantId!;
  const user = (req as any).user;

  const hotel = await prisma.hotel.create({
    data: {
      name,
      address,
      tenantId,
    },
  });

  res.status(201).json({
    hotel,
    createdBy: user.userId,
  });
});
