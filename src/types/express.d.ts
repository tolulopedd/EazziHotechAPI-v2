import type { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      tenantId?: string;
      tenantSubscription?: {
        subscriptionStatus: "ACTIVE" | "GRACE" | "SUSPENDED";
        currentPeriodEndAt: Date | null;
        graceEndsAt: Date | null;
        daysToExpiry: number | null;
      };
      user?: {
        userId: string;
        tenantId: string;
        role: UserRole;
        iat?: number;
        exp?: number;
      };
    }
  }
}

export {};
