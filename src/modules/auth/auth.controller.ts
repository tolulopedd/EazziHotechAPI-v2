import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { registerSchema, loginSchema } from "./auth.schema";
import * as service from "./auth.service";
import { AppError } from "../../common/errors/AppError";

export const register = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenantId) throw new AppError("Tenant missing on request", 500, "TENANT_CONTEXT_MISSING");

  const data = registerSchema.parse(req.body);
  const result = await service.register(req.tenantId, data);

  res.status(201).json(result);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenantId) throw new AppError("Tenant missing on request", 500, "TENANT_CONTEXT_MISSING");

  const data = loginSchema.parse(req.body);
  const result = await service.login(req.tenantId, data);

  res.json(result);
});
