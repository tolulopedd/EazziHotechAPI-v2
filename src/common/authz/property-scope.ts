import type { Request } from "express";
import { prisma } from "../../prisma/client";
import { AppError } from "../errors/AppError";

type Role = "ADMIN" | "MANAGER" | "STAFF";

type JwtUser = {
  userId: string;
  tenantId: string;
  role: Role;
};

export type PropertyScope = {
  role: Role;
  propertyIds: string[] | null;
};

function getActor(req: Request): JwtUser {
  const actor = (req as any).user as JwtUser | undefined;
  if (!actor) throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  return actor;
}

function getTenantId(req: Request): string {
  const tenantId = (req as any).tenantId as string | undefined;
  if (!tenantId) throw new AppError("Tenant missing on request", 400, "TENANT_REQUIRED");
  return tenantId;
}

function uniqueIds(values: string[] | null | undefined) {
  const set = new Set<string>();
  for (const v of values ?? []) {
    const next = String(v || "").trim();
    if (next) set.add(next);
  }
  return Array.from(set);
}

export async function resolvePropertyScope(req: Request): Promise<PropertyScope> {
  const actor = getActor(req);
  const tenantId = getTenantId(req);

  if (actor.role === "ADMIN") {
    return { role: "ADMIN", propertyIds: null };
  }

  const user = await prisma.user.findFirst({
    where: { id: actor.userId, tenantId },
    select: { id: true, role: true, status: true, assignedPropertyIds: true },
  });

  if (!user) throw new AppError("User not found", 401, "UNAUTHORIZED");
  if (user.status !== "ACTIVE") {
    throw new AppError("User account is disabled", 403, "USER_DISABLED");
  }

  return {
    role: user.role as Role,
    propertyIds: uniqueIds(user.assignedPropertyIds),
  };
}

export function scopedPropertyWhere(scope: PropertyScope) {
  if (scope.propertyIds === null) return {};
  return { id: { in: scope.propertyIds } };
}

export function scopedUnitWhere(scope: PropertyScope) {
  if (scope.propertyIds === null) return {};
  return { propertyId: { in: scope.propertyIds } };
}

export function scopedBookingWhere(scope: PropertyScope) {
  if (scope.propertyIds === null) return {};
  return { unit: { propertyId: { in: scope.propertyIds } } };
}

export function assertPropertyInScope(scope: PropertyScope, propertyId: string) {
  if (scope.propertyIds === null) return;
  if (!scope.propertyIds.includes(propertyId)) {
    throw new AppError("You do not have access to this property", 403, "PROPERTY_SCOPE_FORBIDDEN");
  }
}
