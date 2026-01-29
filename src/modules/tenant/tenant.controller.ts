import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";

type Role = "ADMIN" | "MANAGER" | "STAFF";
type JwtUser = { userId: string; tenantId: string; role: Role };

function getActor(req: Request): JwtUser {
  const u = (req as any).user as JwtUser | undefined;
  if (!u) throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  return u;
}

function getTenantId(req: Request): string {
  const tid = (req as any).tenantId as string | undefined;
  if (!tid) throw new AppError("Missing tenant context", 400, "TENANT_REQUIRED");
  return tid;
}

function safeTenant(t: any) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    email: t.email,
    phone: t.phone,
    address: t.address,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function safeSettings(s: any) {
  return {
    minDepositPercent: s.minDepositPercent,
    maxProperties: s.maxProperties,
    maxUnits: s.maxUnits,
    maxUsers: s.maxUsers,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/**
 * GET /api/tenant
 * ✅ Everyone can view tenant + settings
 */
export async function getMyTenant(req: Request, res: Response, next: NextFunction) {
  try {
    getActor(req); // must be logged in
    const tenantId = getTenantId(req);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { settings: true },
    });

    if (!tenant) throw new AppError("Tenant not found", 404, "NOT_FOUND");

    // Ensure settings exists (defaults). Still view-only.
    let settings = tenant.settings;
    if (!settings) {
      settings = await prisma.tenantSettings.create({ data: { tenantId } });
    }

    return res.json({
      tenant: safeTenant(tenant),
      settings: safeSettings(settings),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/tenant
 * ✅ ADMIN only: update tenant basic info (NOT settings)
 */
export async function updateMyTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActor(req);
    if (actor.role !== "ADMIN") throw new AppError("Admin access required", 403, "FORBIDDEN");

    const tenantId = getTenantId(req);

    const { name, slug, email, phone, address } = req.body as {
      name?: string;
      slug?: string;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
    };

    if (name !== undefined && !name.trim()) throw new AppError("name cannot be empty", 400, "VALIDATION_ERROR");
    if (slug !== undefined && !slug.trim()) throw new AppError("slug cannot be empty", 400, "VALIDATION_ERROR");

    // slug uniqueness
    if (slug) {
      const exists = await prisma.tenant.findFirst({
        where: { slug: slug.trim(), NOT: { id: tenantId } },
        select: { id: true },
      });
      if (exists) throw new AppError("Workspace slug already taken", 409, "SLUG_TAKEN");
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(slug !== undefined ? { slug: slug.trim() } : {}),
        ...(email !== undefined ? { email: email ? email.trim() : null } : {}),
        ...(phone !== undefined ? { phone: phone ? phone.trim() : null } : {}),
        ...(address !== undefined ? { address: address ? address.trim() : null } : {}),
      },
      include: { settings: true },
    });

    // Ensure settings exists (defaults)
    let settings = updated.settings;
    if (!settings) {
      settings = await prisma.tenantSettings.create({ data: { tenantId } });
    }

    return res.json({
      tenant: safeTenant(updated),
      settings: safeSettings(settings),
    });
  } catch (err) {
    next(err);
  }
}
