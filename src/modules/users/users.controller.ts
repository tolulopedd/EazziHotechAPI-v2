import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { passwordPolicyErrors } from "../../common/auth/passwordPolicy";

type Role = "ADMIN" | "MANAGER" | "STAFF";
type JwtUser = { userId: string; tenantId: string; role: Role };
type UserStatus = "ACTIVE" | "DISABLED";

function getActor(req: Request): JwtUser {
  const u = (req as any).user as JwtUser | undefined;
  if (!u) throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  return u;
}

function getTenant(req: Request): string {
  const tid = (req as any).tenantId as string | undefined;
  if (!tid) throw new AppError("Tenant missing on request", 400, "TENANT_REQUIRED");
  return tid;
}

function canManagerActOnTarget(actorRole: Role, targetRole: Role) {
  if (actorRole === "ADMIN") return true;
  if (actorRole === "MANAGER") return targetRole === "STAFF";
  return false;
}

function canAssignRole(actorRole: Role, newRole: Role) {
  if (actorRole === "ADMIN") return true;
  if (actorRole === "MANAGER") return newRole === "STAFF";
  return false;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeAssignedPropertyIds(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new AppError("assignedPropertyIds must be an array of property IDs", 400, "VALIDATION_ERROR");
  const uniq = new Set<string>();
  for (const id of value) {
    if (typeof id !== "string" || !id.trim()) {
      throw new AppError("assignedPropertyIds must contain valid property IDs", 400, "VALIDATION_ERROR");
    }
    uniq.add(id.trim());
  }
  return Array.from(uniq);
}

async function validateAssignedPropertyIds(tenantId: string, propertyIds: string[]) {
  if (propertyIds.length === 0) {
    throw new AppError("At least one property must be assigned", 400, "VALIDATION_ERROR");
  }

  const count = await prisma.property.count({
    where: { tenantId, id: { in: propertyIds } },
  });

  if (count !== propertyIds.length) {
    throw new AppError("One or more assigned properties are invalid for this tenant", 400, "VALIDATION_ERROR");
  }
}

function safeUser(u: any) {
  return {
    id: u.id,
    tenantId: u.tenantId,
    email: u.email,
    role: u.role,
    status: u.status,
    fullName: u.fullName,
    phone: u.phone,
    assignedPropertyIds: Array.isArray(u.assignedPropertyIds) ? u.assignedPropertyIds : [],
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

/**
 * GET /api/users?search=&role=&status=&page=&pageSize=
 */
export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActor(req);
    const tenantId = getTenant(req);

    const search = (req.query.search as string | undefined)?.trim();
    const roleQuery = (req.query.role as string | undefined)?.trim().toUpperCase();
    const statusQuery = (req.query.status as string | undefined)?.trim().toUpperCase();
    const role = roleQuery
      ? (["ADMIN", "MANAGER", "STAFF"].includes(roleQuery) ? (roleQuery as Role) : null)
      : undefined;
    const status = statusQuery
      ? (["ACTIVE", "DISABLED"].includes(statusQuery) ? (statusQuery as UserStatus) : null)
      : undefined;

    if (role === null) throw new AppError("Invalid role filter", 400, "VALIDATION_ERROR");
    if (status === null) throw new AppError("Invalid status filter", 400, "VALIDATION_ERROR");
    if (actor.role === "MANAGER" && role && role !== "STAFF") {
      throw new AppError("Managers can only view STAFF users", 403, "FORBIDDEN");
    }

    const effectiveRole: Role | undefined = actor.role === "MANAGER" ? "STAFF" : role;

    const page = Math.max(parseInt((req.query.page as string) || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt((req.query.pageSize as string) || "20", 10), 1), 100);
    const skip = (page - 1) * pageSize;

    const where: any = {
      tenantId,
      ...(effectiveRole ? { role: effectiveRole } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { fullName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          tenantId: true,
          email: true,
          role: true,
          status: true,
          fullName: true,
          phone: true,
          assignedPropertyIds: true,
          createdAt: true,
          updatedAt: true,
          // status: true, // ✅ uncomment only if you added status to Prisma
        },
      }),
    ]);

    return res.json({
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      users: users.map(safeUser),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/users/:id
 */
export async function getUserById(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActor(req);
    const tenantId = getTenant(req);
    const id = req.params.id;

    const user = await prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        status: true,
        fullName: true,
        phone: true,
        assignedPropertyIds: true,
        createdAt: true,
        updatedAt: true,
        // status: true, // ✅ uncomment only if you added status
      },
    });

    if (!user) throw new AppError("User not found", 404, "NOT_FOUND");
    if (actor.role === "MANAGER" && user.role !== "STAFF") {
      throw new AppError("Insufficient permissions to view this user", 403, "FORBIDDEN");
    }

    return res.json({ user: safeUser(user) });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/users
 * Body: { email, role, fullName?, phone?, tempPassword? }
 *
 * ADMIN: create ADMIN/MANAGER/STAFF
 * MANAGER: create STAFF only
 */
export async function createStaffOrManager(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActor(req);
    const tenantId = getTenant(req);

    const { email, role, fullName, phone, tempPassword, assignedPropertyIds } = req.body as {
      email?: string;
      role?: Role;
      fullName?: string;
      phone?: string;
      tempPassword?: string;
      assignedPropertyIds?: unknown;
    };

    if (!email || !role) throw new AppError("email and role are required", 400, "VALIDATION_ERROR");
    if (!["ADMIN", "MANAGER", "STAFF"].includes(role)) throw new AppError("Invalid role", 400, "VALIDATION_ERROR");
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) throw new AppError("Invalid email format", 400, "VALIDATION_ERROR");

    if (!canAssignRole(actor.role, role)) {
      throw new AppError("Insufficient permissions to create this role", 403, "FORBIDDEN");
    }

    const normalizedAssigned = normalizeAssignedPropertyIds(assignedPropertyIds);
    if (normalizedAssigned !== undefined && actor.role !== "ADMIN") {
      throw new AppError("Only ADMIN can assign properties", 403, "FORBIDDEN");
    }
    let effectiveAssigned: string[] = [];
    if (role === "MANAGER" || role === "STAFF") {
      if (actor.role === "ADMIN") {
        effectiveAssigned = normalizedAssigned ?? [];
        await validateAssignedPropertyIds(tenantId, effectiveAssigned);
      } else {
        const actorUser = await prisma.user.findFirst({
          where: { id: actor.userId, tenantId },
          select: { assignedPropertyIds: true },
        });
        effectiveAssigned = Array.isArray(actorUser?.assignedPropertyIds) ? actorUser!.assignedPropertyIds : [];
      }
    }

    const existing = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: normalizedEmail } },
      select: { id: true },
    });
    if (existing) throw new AppError("Email already registered", 409, "EMAIL_EXISTS");

    const plain =
      tempPassword?.trim() ||
      `Tmp${Math.random().toString(36).slice(2, 8)}${Date.now().toString().slice(-4)}!`;
    const policy = passwordPolicyErrors(plain);
    if (policy.length > 0) {
      throw new AppError(`Temporary password must include ${policy.join(", ")}`, 400, "WEAK_PASSWORD");
    }
    const passwordHash = await bcrypt.hash(plain, 10);

    const created = await prisma.user.create({
      data: {
        tenantId,
        email: normalizedEmail,
        role,
        fullName: fullName?.trim() || null,
        phone: phone?.trim() || null,
        passwordHash,
        assignedPropertyIds: role === "MANAGER" || role === "STAFF" ? effectiveAssigned : [],
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        status: true,
        fullName: true,
        phone: true,
        assignedPropertyIds: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({
      user: safeUser(created),
      tempPassword: plain,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/users/:id
 * Body: { fullName?, phone?, role? }
 *
 * ADMIN: can update anyone
 * MANAGER: can update STAFF only
 */
export async function updateUserById(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActor(req);
    const tenantId = getTenant(req);
    const id = req.params.id;

    const target = await prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, role: true },
    });
    if (!target) throw new AppError("User not found", 404, "NOT_FOUND");

    if (!canManagerActOnTarget(actor.role, target.role)) {
      throw new AppError("Insufficient permissions to update this user", 403, "FORBIDDEN");
    }

    const { fullName, phone, role, assignedPropertyIds } = req.body as {
      fullName?: string;
      phone?: string;
      role?: Role;
      assignedPropertyIds?: unknown;
    };

    if (role !== undefined) {
      if (!["ADMIN", "MANAGER", "STAFF"].includes(role)) throw new AppError("Invalid role", 400, "VALIDATION_ERROR");
      if (!canAssignRole(actor.role, role)) throw new AppError("Insufficient permissions to assign this role", 403, "FORBIDDEN");
      if (actor.userId === id) throw new AppError("You cannot change your own role", 400, "VALIDATION_ERROR");
    }

    const normalizedAssigned = normalizeAssignedPropertyIds(assignedPropertyIds);
    if (normalizedAssigned !== undefined && actor.role !== "ADMIN") {
      throw new AppError("Only ADMIN can assign properties", 403, "FORBIDDEN");
    }

    const nextRole = role ?? target.role;
    if ((nextRole === "MANAGER" || nextRole === "STAFF") && normalizedAssigned !== undefined) {
      await validateAssignedPropertyIds(tenantId, normalizedAssigned);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(fullName !== undefined ? { fullName: fullName?.trim() || null } : {}),
        ...(phone !== undefined ? { phone: phone?.trim() || null } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(normalizedAssigned !== undefined ? { assignedPropertyIds: normalizedAssigned } : {}),
        ...(role === "ADMIN" ? { assignedPropertyIds: [] } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        status: true,
        fullName: true,
        phone: true,
        assignedPropertyIds: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({ user: safeUser(updated) });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/me
 * STAFF (and all roles): update own profile only (fullName, phone)
 */
export async function updateMyProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActor(req);
    const tenantId = getTenant(req);

    const { fullName, phone } = req.body as { fullName?: string; phone?: string };

    const updated = await prisma.user.update({
      where: { id: actor.userId },
      data: {
        ...(fullName !== undefined ? { fullName: fullName?.trim() || null } : {}),
        ...(phone !== undefined ? { phone: phone?.trim() || null } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        status: true,
        fullName: true,
        phone: true,
        assignedPropertyIds: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (updated.tenantId !== tenantId) throw new AppError("Tenant mismatch", 401, "TENANT_MISMATCH");

    return res.json({ user: safeUser(updated) });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/me/password
 * Body: { currentPassword, newPassword }
 */
export async function changeMyPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActor(req);
    const tenantId = getTenant(req);

    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      throw new AppError("currentPassword and newPassword are required", 400, "VALIDATION_ERROR");
    }
    const policy = passwordPolicyErrors(newPassword);
    if (policy.length > 0) {
      throw new AppError(`Password must include ${policy.join(", ")}`, 400, "WEAK_PASSWORD");
    }

    const user = await prisma.user.findFirst({
      where: { id: actor.userId, tenantId },
      select: { id: true, passwordHash: true },
    });

    if (!user) throw new AppError("User not found", 404, "NOT_FOUND");

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new AppError("Current password is incorrect", 401, "INVALID_CREDENTIALS");

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
      select: { id: true },
    });

    return res.json({ message: "Password updated successfully" });
  } catch (err) {
    next(err);
  }
}


export async function disableUser(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActor(req);
    const tenantId = getTenant(req);
    const id = req.params.id;

    if (actor.userId === id) {
      throw new AppError("You cannot disable your own account", 400, "VALIDATION_ERROR");
    }

    const target = await prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, role: true, status: true },
    });

    if (!target) throw new AppError("User not found", 404, "NOT_FOUND");
    if (!canManagerActOnTarget(actor.role, target.role)) {
      throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { status: "DISABLED" },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        status: true,
        fullName: true,
        phone: true,
        assignedPropertyIds: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({ user: safeUser(updated) });
  } catch (err) {
    next(err);
  }
}

export async function enableUser(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActor(req);
    const tenantId = getTenant(req);
    const id = req.params.id;

    const target = await prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, role: true },
    });

    if (!target) throw new AppError("User not found", 404, "NOT_FOUND");
    if (!canManagerActOnTarget(actor.role, target.role)) {
      throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { status: "ACTIVE" },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        status: true,
        fullName: true,
        phone: true,
        assignedPropertyIds: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({ user: safeUser(updated) });
  } catch (err) {
    next(err);
  }
}
