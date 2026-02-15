import type { Request, Response, NextFunction } from "express";
import { AppError } from "../common/errors/AppError";
import { logger } from "../common/logger/logger";
import { trackError } from "../common/observability/error-tracker";

export function errorMiddleware(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof AppError ? err.statusCode : 500;
  const code = err instanceof AppError ? err.code : "INTERNAL_ERROR";
  const message = err instanceof AppError ? err.message : "Something went wrong";
  const details = err instanceof AppError ? err.details : undefined;

  const userId = req.user?.userId;
  const context = {
    requestId: req.requestId,
    code,
    status,
    method: req.method,
    path: req.originalUrl,
    tenantId: req.tenantId,
    userId,
  };

  logger.error({ err, ...context }, message);
  if (status >= 500) {
    trackError(err, context);
  }

  res.status(status).json({
    error: { code, message, requestId: req.requestId ?? null, ...(details ? { details } : {}) },
  });
}
