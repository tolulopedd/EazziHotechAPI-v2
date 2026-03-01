import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { isSuperAdminEmail } from "../../common/auth/superadmin";

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
  const daysToExpiry = t.currentPeriodEndAt
    ? Math.ceil((new Date(t.currentPeriodEndAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    subscriptionStatus: t.subscriptionStatus,
    currentPeriodEndAt: t.currentPeriodEndAt,
    graceEndsAt: t.graceEndsAt,
    lastReminderSentAt: t.lastReminderSentAt,
    lastSuspensionNoticeAt: t.lastSuspensionNoticeAt,
    lastReactivationNoticeAt: t.lastReactivationNoticeAt,
    daysToExpiry,
    expiringSoon: typeof daysToExpiry === "number" && daysToExpiry >= 0 && daysToExpiry <= 3,
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

function parseOptionalDate(value: string | null | undefined, field: string) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`${field} must be a valid ISO datetime`, 400, "VALIDATION_ERROR");
  }
  return d;
}

function validateSubscriptionDates(
  subscriptionStatus: "ACTIVE" | "GRACE" | "SUSPENDED",
  currentEndDate: Date | null | undefined,
  graceEndDate: Date | null | undefined
) {
  if (currentEndDate && graceEndDate && graceEndDate.getTime() < currentEndDate.getTime()) {
    throw new AppError("graceEndsAt cannot be before currentPeriodEndAt", 400, "VALIDATION_ERROR");
  }
  if (subscriptionStatus === "GRACE" && !graceEndDate) {
    throw new AppError("graceEndsAt is required when subscriptionStatus is GRACE", 400, "VALIDATION_ERROR");
  }
}

function normalizeOptionalString(value: unknown) {
  if (value === null || value === undefined) return null;
  const next = String(value).trim();
  return next ? next : null;
}

async function requireSuperAdmin(req: Request) {
  const actor = getActor(req);
  const actorUser = await prisma.user.findFirst({
    where: { id: actor.userId, tenantId: actor.tenantId },
    select: { email: true },
  });
  if (!actorUser) throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  if (!isSuperAdminEmail(actorUser.email)) {
    throw new AppError("Super admin access required", 403, "SUPERADMIN_REQUIRED");
  }
}

/**
 * POST /api/platform/tenants
 * ✅ SUPERADMIN only: create tenant + settings + first ADMIN user in one transaction
 */
export async function createPlatformTenant(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);

    const {
      name,
      slug,
      email,
      phone,
      address,
      subscriptionStatus,
      currentPeriodEndAt,
      graceEndsAt,
      settings,
      adminUser,
    } = req.body as {
      name?: string;
      slug?: string;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      subscriptionStatus?: "ACTIVE" | "GRACE" | "SUSPENDED";
      currentPeriodEndAt?: string | null;
      graceEndsAt?: string | null;
      settings?: {
        minDepositPercent?: number;
        maxProperties?: number;
        maxUnits?: number;
        maxUsers?: number;
      };
      adminUser?: {
        email?: string;
        password?: string;
        fullName?: string | null;
        phone?: string | null;
      };
    };

    if (!name?.trim()) throw new AppError("name is required", 400, "VALIDATION_ERROR");
    if (!slug?.trim()) throw new AppError("slug is required", 400, "VALIDATION_ERROR");
    if (!adminUser?.email?.trim()) throw new AppError("adminUser.email is required", 400, "VALIDATION_ERROR");
    if (!adminUser?.password || adminUser.password.length < 8) {
      throw new AppError("adminUser.password must be at least 8 characters", 400, "VALIDATION_ERROR");
    }

    const normalizedSubscriptionStatus = subscriptionStatus ?? "ACTIVE";
    if (!["ACTIVE", "GRACE", "SUSPENDED"].includes(normalizedSubscriptionStatus)) {
      throw new AppError("subscriptionStatus must be ACTIVE, GRACE, or SUSPENDED", 400, "VALIDATION_ERROR");
    }

    const normalizedSlug = slug.trim().toLowerCase();
    const normalizedAdminEmail = adminUser.email.trim().toLowerCase();
    const currentEndDate = parseOptionalDate(currentPeriodEndAt, "currentPeriodEndAt");
    const graceEndDate = parseOptionalDate(graceEndsAt, "graceEndsAt");
    validateSubscriptionDates(normalizedSubscriptionStatus, currentEndDate, graceEndDate);

    const numericSettings = {
      minDepositPercent: settings?.minDepositPercent,
      maxProperties: settings?.maxProperties,
      maxUnits: settings?.maxUnits,
      maxUsers: settings?.maxUsers,
    };
    if (
      numericSettings.minDepositPercent !== undefined &&
      (!Number.isInteger(numericSettings.minDepositPercent) ||
        numericSettings.minDepositPercent < 0 ||
        numericSettings.minDepositPercent > 100)
    ) {
      throw new AppError("settings.minDepositPercent must be an integer between 0 and 100", 400, "VALIDATION_ERROR");
    }
    if (
      numericSettings.maxProperties !== undefined &&
      (!Number.isInteger(numericSettings.maxProperties) || numericSettings.maxProperties < 1)
    ) {
      throw new AppError("settings.maxProperties must be an integer >= 1", 400, "VALIDATION_ERROR");
    }
    if (numericSettings.maxUnits !== undefined && (!Number.isInteger(numericSettings.maxUnits) || numericSettings.maxUnits < 1)) {
      throw new AppError("settings.maxUnits must be an integer >= 1", 400, "VALIDATION_ERROR");
    }
    if (numericSettings.maxUsers !== undefined && (!Number.isInteger(numericSettings.maxUsers) || numericSettings.maxUsers < 1)) {
      throw new AppError("settings.maxUsers must be an integer >= 1", 400, "VALIDATION_ERROR");
    }

    const existingTenant = await prisma.tenant.findFirst({
      where: { slug: normalizedSlug },
      select: { id: true },
    });
    if (existingTenant) throw new AppError("Workspace slug already taken", 409, "SLUG_TAKEN");

    const passwordHash = await bcrypt.hash(adminUser.password, 10);
    const nextTenantStatus = normalizedSubscriptionStatus === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";

    const created = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: name.trim(),
          slug: normalizedSlug,
          email: normalizeOptionalString(email),
          phone: normalizeOptionalString(phone),
          address: normalizeOptionalString(address),
          status: nextTenantStatus,
          subscriptionStatus: normalizedSubscriptionStatus,
          ...(currentEndDate !== undefined ? { currentPeriodEndAt: currentEndDate } : {}),
          ...(graceEndDate !== undefined ? { graceEndsAt: graceEndDate } : {}),
          ...(normalizedSubscriptionStatus === "SUSPENDED" ? { lastSuspensionNoticeAt: new Date() } : {}),
        },
      });

      const tenantSettings = await tx.tenantSettings.create({
        data: {
          tenantId: tenant.id,
          ...(numericSettings.minDepositPercent !== undefined
            ? { minDepositPercent: numericSettings.minDepositPercent }
            : {}),
          ...(numericSettings.maxProperties !== undefined ? { maxProperties: numericSettings.maxProperties } : {}),
          ...(numericSettings.maxUnits !== undefined ? { maxUnits: numericSettings.maxUnits } : {}),
          ...(numericSettings.maxUsers !== undefined ? { maxUsers: numericSettings.maxUsers } : {}),
        },
      });

      const firstAdmin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: normalizedAdminEmail,
          passwordHash,
          role: "ADMIN",
          status: "ACTIVE",
          fullName: normalizeOptionalString(adminUser.fullName),
          phone: normalizeOptionalString(adminUser.phone),
        },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          fullName: true,
          phone: true,
          createdAt: true,
        },
      });

      return { tenant, tenantSettings, firstAdmin };
    });

    return res.status(201).json({
      tenant: safeTenant(created.tenant),
      settings: safeSettings(created.tenantSettings),
      firstAdmin: created.firstAdmin,
    });
  } catch (err) {
    next(err);
  }
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

/**
 * PATCH /api/tenant/subscription
 * ✅ SUPERADMIN only: manual phase-1 subscription controls
 */
export async function updateMyTenantSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);

    const tenantId = getTenantId(req);

    const {
      subscriptionStatus,
      currentPeriodEndAt,
      graceEndsAt,
    } = req.body as {
      subscriptionStatus?: "ACTIVE" | "GRACE" | "SUSPENDED";
      currentPeriodEndAt?: string | null;
      graceEndsAt?: string | null;
    };

    if (!subscriptionStatus || !["ACTIVE", "GRACE", "SUSPENDED"].includes(subscriptionStatus)) {
      throw new AppError("subscriptionStatus must be ACTIVE, GRACE, or SUSPENDED", 400, "VALIDATION_ERROR");
    }

    const currentEndDate = parseOptionalDate(currentPeriodEndAt, "currentPeriodEndAt");
    const graceEndDate = parseOptionalDate(graceEndsAt, "graceEndsAt");
    validateSubscriptionDates(subscriptionStatus, currentEndDate, graceEndDate);

    const before = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true, subscriptionStatus: true },
    });
    if (!before) throw new AppError("Tenant not found", 404, "NOT_FOUND");

    const nextTenantStatus = subscriptionStatus === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        status: nextTenantStatus,
        subscriptionStatus,
        ...(currentEndDate !== undefined ? { currentPeriodEndAt: currentEndDate } : {}),
        ...(graceEndDate !== undefined ? { graceEndsAt: graceEndDate } : {}),
        ...(subscriptionStatus === "SUSPENDED" ? { lastSuspensionNoticeAt: new Date() } : {}),
        ...(before.subscriptionStatus === "SUSPENDED" && subscriptionStatus !== "SUSPENDED"
          ? { lastReactivationNoticeAt: new Date() }
          : {}),
      },
      include: { settings: true },
    });

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

/**
 * GET /api/platform/tenants?search=&page=&pageSize=
 * ✅ SUPERADMIN only: list all tenants across platform
 */
export async function listPlatformTenants(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);

    const search = (req.query.search as string | undefined)?.trim();
    const page = Math.max(parseInt((req.query.page as string) || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt((req.query.pageSize as string) || "100", 10), 1), 200);
    const skip = (page - 1) * pageSize;

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [total, tenants] = await Promise.all([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          settings: true,
          _count: {
            select: {
              properties: true,
              units: true,
              users: true,
            },
          },
        },
      }),
    ]);

    return res.json({
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      tenants: tenants.map((t) => ({
        ...safeTenant(t),
        settings: t.settings ? safeSettings(t.settings) : null,
        propertiesCount: t._count?.properties ?? 0,
        unitsCount: t._count?.units ?? 0,
        usersCount: t._count?.users ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/platform/tenants/:tenantId/subscription
 * ✅ SUPERADMIN only: update subscription for any tenant
 */
export async function updatePlatformTenantSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);

    const tenantId = String(req.params.tenantId || "").trim();
    if (!tenantId) throw new AppError("tenantId is required", 400, "VALIDATION_ERROR");

    const {
      subscriptionStatus,
      currentPeriodEndAt,
      graceEndsAt,
    } = req.body as {
      subscriptionStatus?: "ACTIVE" | "GRACE" | "SUSPENDED";
      currentPeriodEndAt?: string | null;
      graceEndsAt?: string | null;
    };

    if (!subscriptionStatus || !["ACTIVE", "GRACE", "SUSPENDED"].includes(subscriptionStatus)) {
      throw new AppError("subscriptionStatus must be ACTIVE, GRACE, or SUSPENDED", 400, "VALIDATION_ERROR");
    }

    const currentEndDate = parseOptionalDate(currentPeriodEndAt, "currentPeriodEndAt");
    const graceEndDate = parseOptionalDate(graceEndsAt, "graceEndsAt");
    validateSubscriptionDates(subscriptionStatus, currentEndDate, graceEndDate);

    const before = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true, subscriptionStatus: true },
    });
    if (!before) throw new AppError("Tenant not found", 404, "NOT_FOUND");

    const nextTenantStatus = subscriptionStatus === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        status: nextTenantStatus,
        subscriptionStatus,
        ...(currentEndDate !== undefined ? { currentPeriodEndAt: currentEndDate } : {}),
        ...(graceEndDate !== undefined ? { graceEndsAt: graceEndDate } : {}),
        ...(subscriptionStatus === "SUSPENDED" ? { lastSuspensionNoticeAt: new Date() } : {}),
        ...(before.subscriptionStatus === "SUSPENDED" && subscriptionStatus !== "SUSPENDED"
          ? { lastReactivationNoticeAt: new Date() }
          : {}),
      },
    });

    return res.json({ tenant: safeTenant(updated) });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/platform/tenants/:tenantId/settings
 * ✅ SUPERADMIN only: update tenant policy + plan limits for any tenant
 */
export async function updatePlatformTenantSettings(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);

    const tenantId = String(req.params.tenantId || "").trim();
    if (!tenantId) throw new AppError("tenantId is required", 400, "VALIDATION_ERROR");

    const {
      minDepositPercent,
      maxProperties,
      maxUnits,
      maxUsers,
    } = req.body as {
      minDepositPercent?: number;
      maxProperties?: number;
      maxUnits?: number;
      maxUsers?: number;
    };

    const nextValues = {
      minDepositPercent: minDepositPercent !== undefined ? Number(minDepositPercent) : undefined,
      maxProperties: maxProperties !== undefined ? Number(maxProperties) : undefined,
      maxUnits: maxUnits !== undefined ? Number(maxUnits) : undefined,
      maxUsers: maxUsers !== undefined ? Number(maxUsers) : undefined,
    };

    if (
      nextValues.minDepositPercent !== undefined &&
      (!Number.isInteger(nextValues.minDepositPercent) ||
        nextValues.minDepositPercent < 0 ||
        nextValues.minDepositPercent > 100)
    ) {
      throw new AppError("minDepositPercent must be an integer between 0 and 100", 400, "VALIDATION_ERROR");
    }
    if (nextValues.maxProperties !== undefined && (!Number.isInteger(nextValues.maxProperties) || nextValues.maxProperties < 1)) {
      throw new AppError("maxProperties must be an integer >= 1", 400, "VALIDATION_ERROR");
    }
    if (nextValues.maxUnits !== undefined && (!Number.isInteger(nextValues.maxUnits) || nextValues.maxUnits < 1)) {
      throw new AppError("maxUnits must be an integer >= 1", 400, "VALIDATION_ERROR");
    }
    if (nextValues.maxUsers !== undefined && (!Number.isInteger(nextValues.maxUsers) || nextValues.maxUsers < 1)) {
      throw new AppError("maxUsers must be an integer >= 1", 400, "VALIDATION_ERROR");
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError("Tenant not found", 404, "NOT_FOUND");

    const settings = await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ...(nextValues.minDepositPercent !== undefined ? { minDepositPercent: nextValues.minDepositPercent } : {}),
        ...(nextValues.maxProperties !== undefined ? { maxProperties: nextValues.maxProperties } : {}),
        ...(nextValues.maxUnits !== undefined ? { maxUnits: nextValues.maxUnits } : {}),
        ...(nextValues.maxUsers !== undefined ? { maxUsers: nextValues.maxUsers } : {}),
      },
      update: {
        ...(nextValues.minDepositPercent !== undefined ? { minDepositPercent: nextValues.minDepositPercent } : {}),
        ...(nextValues.maxProperties !== undefined ? { maxProperties: nextValues.maxProperties } : {}),
        ...(nextValues.maxUnits !== undefined ? { maxUnits: nextValues.maxUnits } : {}),
        ...(nextValues.maxUsers !== undefined ? { maxUsers: nextValues.maxUsers } : {}),
      },
    });

    return res.json({
      tenant: safeTenant(tenant),
      settings: safeSettings(settings),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/platform/tenant-admins?search=&tenantId=&status=&page=&pageSize=
 * ✅ SUPERADMIN only: list ADMIN users across all tenants
 */
export async function listPlatformTenantAdmins(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);

    const search = (req.query.search as string | undefined)?.trim();
    const tenantId = (req.query.tenantId as string | undefined)?.trim();
    const statusQuery = (req.query.status as string | undefined)?.trim().toUpperCase();
    const status = statusQuery
      ? (["ACTIVE", "DISABLED"].includes(statusQuery) ? statusQuery : null)
      : undefined;
    if (status === null) throw new AppError("Invalid status filter", 400, "VALIDATION_ERROR");

    const page = Math.max(parseInt((req.query.page as string) || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt((req.query.pageSize as string) || "20", 10), 1), 200);
    const skip = (page - 1) * pageSize;

    const where: any = {
      role: "ADMIN",
      ...(tenantId ? { tenantId } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { fullName: { contains: search, mode: "insensitive" } },
              { tenant: { name: { contains: search, mode: "insensitive" } } },
              { tenant: { slug: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          tenantId: true,
          email: true,
          role: true,
          status: true,
          fullName: true,
          phone: true,
          createdAt: true,
          updatedAt: true,
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
              status: true,
              subscriptionStatus: true,
            },
          },
        },
      }),
    ]);

    return res.json({
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      users,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/platform/users/:userId
 * ✅ SUPERADMIN only: update any user across tenants
 */
export async function updatePlatformUser(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);

    const userId = String(req.params.userId || "").trim();
    if (!userId) throw new AppError("userId is required", 400, "VALIDATION_ERROR");

    const { fullName, phone, role } = req.body as {
      fullName?: string | null;
      phone?: string | null;
      role?: "ADMIN" | "MANAGER" | "STAFF";
    };

    if (role !== undefined && !["ADMIN", "MANAGER", "STAFF"].includes(role)) {
      throw new AppError("role must be ADMIN, MANAGER, or STAFF", 400, "VALIDATION_ERROR");
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!target) throw new AppError("User not found", 404, "NOT_FOUND");

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(fullName !== undefined ? { fullName: normalizeOptionalString(fullName) } : {}),
        ...(phone !== undefined ? { phone: normalizeOptionalString(phone) } : {}),
        ...(role !== undefined ? { role } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        status: true,
        fullName: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            subscriptionStatus: true,
          },
        },
      },
    });

    return res.json({ user: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/platform/users/:userId/disable
 * POST /api/platform/users/:userId/enable
 * ✅ SUPERADMIN only
 */
export async function togglePlatformUserStatus(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);

    const userId = String(req.params.userId || "").trim();
    if (!userId) throw new AppError("userId is required", 400, "VALIDATION_ERROR");

    const action = String(req.params.action || "").trim().toLowerCase();
    if (!["disable", "enable"].includes(action)) {
      throw new AppError("action must be disable or enable", 400, "VALIDATION_ERROR");
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!target) throw new AppError("User not found", 404, "NOT_FOUND");

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { status: action === "disable" ? "DISABLED" : "ACTIVE" },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        status: true,
        fullName: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            subscriptionStatus: true,
          },
        },
      },
    });

    return res.json({ user: updated });
  } catch (err) {
    next(err);
  }
}
