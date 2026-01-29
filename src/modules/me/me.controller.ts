// src/modules/me/me.controller.ts
import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { prismaForTenant } from "../../../prisma/tenantPrisma";

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const userId = (req as any).user?.userId;

  if (!userId) {
    throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const db = prismaForTenant(tenantId);

  const user = await db.raw.user.findFirst({
    where: { id: userId, tenantId },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,

      // only if you added these fields
      fullName: true,
      phone: true,
    },
  });

  if (!user) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  res.json({ user });
});
