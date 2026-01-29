import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";

type Role = "ADMIN" | "MANAGER" | "STAFF";
type JwtUser = { userId: string; tenantId: string; role: Role };

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

function safeUser(u: any) {
  return {
    id: u.id,
    tenantId: u.tenantId,
    email: u.email,
    role: u.role,
    // status: u.status, // ✅ include only if you added status field
    fullName: u.fullName,
    phone: u.phone,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

/**
 * GET /api/users?search=&role=&status=&page=&pageSize=
 */
export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    getActor(req);
    const tenantId = getTenant(req);

    const search = (req.query.search as string | undefined)?.trim();
    const role = (req.query.role as Role | undefined)?.trim() as Role | undefined;

    // If you have status in schema, you can use it; otherwise ignore it
    const status = (req.query.status as "ACTIVE" | "DISABLED" | undefined)?.trim();

    const page = Math.max(parseInt((req.query.page as string) || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt((req.query.pageSize as string) || "20", 10), 1), 100);
    const skip = (page - 1) * pageSize;

    const where: any = {
      tenantId,
      ...(role ? { role } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { fullName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      // ...(status ? { status } : {}), // ✅ uncomment only if you added status to Prisma
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
          fullName: true,
          phone: true,
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
    getActor(req);
    const tenantId = getTenant(req);
    const id = req.params.id;

    const user = await prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        fullName: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
        // status: true, // ✅ uncomment only if you added status
      },
    });

    if (!user) throw new AppError("User not found", 404, "NOT_FOUND");

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

    const { email, role, fullName, phone, tempPassword } = req.body as {
      email?: string;
      role?: Role;
      fullName?: string;
      phone?: string;
      tempPassword?: string;
    };

    if (!email || !role) throw new AppError("email and role are required", 400, "VALIDATION_ERROR");
    if (!["ADMIN", "MANAGER", "STAFF"].includes(role)) throw new AppError("Invalid role", 400, "VALIDATION_ERROR");

    if (!canAssignRole(actor.role, role)) {
      throw new AppError("Insufficient permissions to create this role", 403, "FORBIDDEN");
    }

    const existing = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true },
    });
    if (existing) throw new AppError("Email already registered", 409, "EMAIL_EXISTS");

    const plain = tempPassword?.trim() || "Welcome123!";
    const passwordHash = await bcrypt.hash(plain, 10);

    const created = await prisma.user.create({
      data: {
        tenantId,
        email,
        role,
        fullName: fullName?.trim() || null,
        phone: phone?.trim() || null,
        passwordHash,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        fullName: true,
        phone: true,
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

    const { fullName, phone, role } = req.body as { fullName?: string; phone?: string; role?: Role };

    if (role !== undefined) {
      if (!["ADMIN", "MANAGER", "STAFF"].includes(role)) throw new AppError("Invalid role", 400, "VALIDATION_ERROR");
      if (!canAssignRole(actor.role, role)) throw new AppError("Insufficient permissions to assign this role", 403, "FORBIDDEN");
      if (actor.userId === id) throw new AppError("You cannot change your own role", 400, "VALIDATION_ERROR");
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(fullName !== undefined ? { fullName: fullName?.trim() || null } : {}),
        ...(phone !== undefined ? { phone: phone?.trim() || null } : {}),
        ...(role !== undefined ? { role } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        fullName: true,
        phone: true,
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
        fullName: true,
        phone: true,
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
    });

    return res.json({ user: safeUser(updated) });
  } catch (err) {
    next(err);
  }
}
