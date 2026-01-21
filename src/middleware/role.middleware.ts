import type { Request, Response, NextFunction } from "express";
import { AppError } from "../common/errors/AppError";

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      return next(new AppError("Authentication required", 401, "UNAUTHORIZED"));
    }

    if (!allowedRoles.includes(user.role)) {
      return next(
        new AppError("Insufficient permissions", 403, "FORBIDDEN")
      );
    }

    next();
  };
}
