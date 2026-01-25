import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { registerSchema, loginSchema } from "./auth.schema";
import * as service from "./auth.service";
import { AppError } from "../../common/errors/AppError";
import { prisma } from "../../prisma/client"; // raw prisma (NOT tenant prisma)

export const register = asyncHandler(async (req: Request, res: Response) => {
  // keep register tenant-scoped for now (requires x-tenant-id)
  if (!req.tenantId) {
    throw new AppError("Tenant missing on request", 500, "TENANT_CONTEXT_MISSING");
  }

  const data = registerSchema.parse(req.body);
  const result = await service.register(req.tenantId, data);

  res.status(201).json(result);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  // ✅ login no longer requires req.tenantId
  // We'll resolve tenant from body (tenantSlug or tenantId)

  const data = loginSchema.parse(req.body);

  // Expect loginSchema to include tenantSlug OR tenantId
  const tenant =
    data.tenantId
      ? await prisma.tenant.findFirst({
          where: { id: data.tenantId, status: "ACTIVE" },
          select: { id: true },
        })
      : await prisma.tenant.findFirst({
          where: { slug: data.tenantSlug, status: "ACTIVE" },
          select: { id: true },
        });

  if (!tenant) {
    throw new AppError("Invalid tenant", 401, "TENANT_INVALID");
  }

  const result = await service.login(tenant.id, data);
  res.json(result);
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  // expects { tenantId? , tenantSlug?, email }
  const { tenantId, tenantSlug, email } = req.body;
  if (!email) throw new AppError("Email is required", 400);
  await service.sendResetLink({ tenantId, tenantSlug, email });
  res.json({ message: "If the email exists, a reset link has been sent" });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  // expects { token, newPassword }
  const { token, newPassword } = req.body;
  if (!token || !newPassword) throw new AppError("Token and newPassword are required", 400);
  await service.resetPassword(token, newPassword);
  res.json({ message: "Password has been reset successfully" });
});
