import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { isSuperAdminEmail } from "../../common/auth/superadmin";
import { passwordPolicyErrors } from "../../common/auth/passwordPolicy";
import { resetPassword, sendResetLink } from "./auth.service";

type UserRole = "ADMIN" | "MANAGER" | "STAFF";

function signAccessToken(payload: { userId: string; tenantId: string; role: UserRole }) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: "1h" });
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = (req as any).tenantId as string | undefined;
    if (!tenantId) throw new AppError("Tenant missing on request", 400, "TENANT_CONTEXT_MISSING");

    const { email, password, role, fullName, phone } = req.body as {
      email?: string;
      password?: string;
      role?: UserRole;
      fullName?: string;
      phone?: string;
    };

    if (!email || !password || !role) {
      throw new AppError("email, password and role are required", 400, "VALIDATION_ERROR");
    }

    if (!["ADMIN", "MANAGER", "STAFF"].includes(role)) {
      throw new AppError("Invalid role", 400, "VALIDATION_ERROR");
    }

    const policy = passwordPolicyErrors(password);
    if (policy.length > 0) {
      throw new AppError(`Password must include ${policy.join(", ")}`, 400, "WEAK_PASSWORD");
    }

    const existing = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true },
    });

    if (existing) throw new AppError("Email already registered", 409, "EMAIL_EXISTS");

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        tenantId,
        email,
        passwordHash,
        role,
        fullName: fullName?.trim() || null,
        phone: phone?.trim() || null,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        fullName: true,
        phone: true,
        createdAt: true,
      },
    });

    const accessToken = signAccessToken({ userId: user.id, tenantId: user.tenantId, role: user.role });

    return res.status(201).json({
      user,
      accessToken,
      tenantId: user.tenantId,
      role: user.role,
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = (req as any).tenantId as string | undefined;
    if (!tenantId) throw new AppError("Tenant missing on request", 400, "TENANT_CONTEXT_MISSING");
    const subscription = (req as any).tenantSubscription as
      | { subscriptionStatus: string; currentPeriodEndAt?: Date | null; daysToExpiry?: number | null }
      | undefined;

    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) throw new AppError("email and password are required", 400, "VALIDATION_ERROR");

    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: {
        id: true,
        tenantId: true,
        role: true,
        passwordHash: true,
        email: true,
        fullName: true,
        status: true,
      },
    });

    if (!user) {
      throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }

    if (user.status === "DISABLED") {
      throw new AppError("Account is disabled", 403, "ACCOUNT_DISABLED");
    }


    // ✅ If you added user.status, enable this:
    // if ((user as any).status === "DISABLED") throw new AppError("Account disabled", 403, "ACCOUNT_DISABLED");

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");

    const accessToken = signAccessToken({ userId: user.id, tenantId: user.tenantId, role: user.role });
    const isSuperAdmin = isSuperAdminEmail(user.email);

    const daysToExpiry = subscription?.daysToExpiry ?? null;
    const expiringSoon = typeof daysToExpiry === "number" && daysToExpiry >= 0 && daysToExpiry <= 3;

    return res.json({
      accessToken,
      tenantId: user.tenantId,
      role: user.role,
      isSuperAdmin,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
      subscription: {
        status: subscription?.subscriptionStatus ?? "ACTIVE",
        currentPeriodEndAt: subscription?.currentPeriodEndAt ?? null,
        daysToExpiry,
        expiringSoon,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantSlug, tenantId, email } = req.body as {
      tenantSlug?: string;
      tenantId?: string;
      email?: string;
    };
    if (!email) throw new AppError("email is required", 400, "VALIDATION_ERROR");

    await sendResetLink({
      tenantSlug: tenantSlug?.trim() || undefined,
      tenantId: tenantId?.trim() || undefined,
      email: email.trim().toLowerCase(),
    });

    return res.json({ message: "If the email exists, a reset link has been sent." });
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordWithToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, newPassword } = req.body as { token?: string; newPassword?: string };
    if (!token || !newPassword) {
      throw new AppError("token and newPassword are required", 400, "VALIDATION_ERROR");
    }
    await resetPassword(token, newPassword);
    return res.json({ message: "Password reset successfully" });
  } catch (err) {
    next(err);
  }
}
