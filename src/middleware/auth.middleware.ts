import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../common/errors/AppError";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) return next(new AppError("Missing authorization token", 401, "UNAUTHORIZED"));

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as any;

    // Optional safety checks:
    if (req.tenantId && payload.tenantId !== req.tenantId) {
      return next(new AppError("Token tenant mismatch", 401, "TENANT_MISMATCH"));
    }

    (req as any).user = payload; // { userId, tenantId, role }
    return next();
  } catch {
    return next(new AppError("Invalid or expired token", 401, "UNAUTHORIZED"));
  }
}
