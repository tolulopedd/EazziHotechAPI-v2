import type { Request, Response, NextFunction } from "express";
import { AppError } from "../common/errors/AppError";
import { logger } from "../common/logger/logger";

export function errorMiddleware(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof AppError ? err.statusCode : 500;
  const code = err instanceof AppError ? err.code : "INTERNAL_ERROR";
  const message = err instanceof AppError ? err.message : "Something went wrong";

  logger.error({ err, code, status }, message);

  res.status(status).json({
    error: { code, message },
  });
}
