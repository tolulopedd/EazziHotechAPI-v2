import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { passwordPolicyErrors } from "../../common/auth/passwordPolicy";
import { sendPasswordResetEmail } from "../../common/notifications/email";

type Tokens = { accessToken: string; refreshToken: string };

function signTokens(payload: { userId: string; tenantId: string; role: string }): Tokens {
  const accessToken = jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  });

  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "30d",
  });

  return { accessToken, refreshToken };
}

export async function register(tenantId: string, input: { email: string; password: string; role?: any }) {
  const existing = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email: input.email } },
  });

  if (existing) throw new AppError("Email already registered for this tenant.", 409, "EMAIL_EXISTS");

  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await prisma.user.create({
    data: {
      tenantId,
      email: input.email,
      passwordHash,
      role: input.role ?? "STAFF",
    },
    select: { id: true, tenantId: true, email: true, role: true, createdAt: true },
  });

  const tokens = signTokens({ userId: user.id, tenantId: user.tenantId, role: user.role });

  return { user, tokens };
}

export async function login(tenantId: string, input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email: input.email } },
  });

  if (!user) throw new AppError("Invalid credentials.", 401, "INVALID_CREDENTIALS");

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new AppError("Invalid credentials.", 401, "INVALID_CREDENTIALS");

  const tokens = signTokens({ userId: user.id, tenantId: user.tenantId, role: user.role });

  return {
    user: { id: user.id, tenantId: user.tenantId, email: user.email, role: user.role, createdAt: user.createdAt },
    tokens,
  };
}

// New: forgot/reset password helpers
export async function sendResetLink(input: { tenantId?: string; tenantSlug?: string; email: string }) {
  const { tenantId, tenantSlug, email } = input;
  const normalizedEmail = email.trim().toLowerCase();
  let user:
    | {
        id: string;
        tenantId: string;
        email: string;
      }
    | null = null;

  if (tenantId || tenantSlug) {
    const tenant = tenantId
      ? await prisma.tenant.findFirst({
          where: { id: tenantId, status: "ACTIVE" },
          select: { id: true },
        })
      : await prisma.tenant.findFirst({
          where: { slug: tenantSlug, status: "ACTIVE" },
          select: { id: true },
        });

    if (!tenant) return; // silence to avoid enumeration

    user = await prisma.user.findFirst({
      where: {
        tenantId: tenant.id,
        email: { equals: normalizedEmail, mode: "insensitive" },
      },
      select: { id: true, tenantId: true, email: true },
    });
  } else {
    // Workspace not selected: resolve by email across active tenants.
    user = await prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: "insensitive" },
        tenant: { status: "ACTIVE" },
      },
      select: { id: true, tenantId: true, email: true },
    });
  }

  if (!user) return; // silence to avoid enumeration

  const secret = process.env.JWT_RESET_SECRET || process.env.JWT_ACCESS_SECRET!;
  const expiresIn = process.env.JWT_RESET_EXPIRES_IN || "1h";

  const resetToken = jwt.sign(
    { userId: user.id, tenantId: user.tenantId, email: user.email },
    secret,
    { expiresIn }
  );

  const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
  const resetLink = `${frontend}/reset-password?token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(
    user.email
  )}`;

  try {
    await sendPasswordResetEmail({
      to: user.email,
      resetLink,
      tenantName: tenantSlug || undefined,
    });
  } catch (err) {
    // Keep forgot-password response generic and non-enumerating.
    // Log provider issues for ops without returning 500 to the client.
    console.error("[auth] Failed to send password reset email", err);
  }
}

export async function resetPassword(token: string, newPassword: string) {
  const policy = passwordPolicyErrors(newPassword);
  if (policy.length > 0) {
    throw new AppError(`Password must include ${policy.join(", ")}`, 400, "WEAK_PASSWORD");
  }

  const secret = process.env.JWT_RESET_SECRET || process.env.JWT_ACCESS_SECRET!;
  let payload: any;
  try {
    payload = jwt.verify(token, secret);
  } catch (err) {
    throw new AppError("Invalid or expired token", 400, "INVALID_TOKEN");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.tenantId !== payload.tenantId) {
    throw new AppError("Invalid token", 400, "INVALID_TOKEN_PAYLOAD");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });
}
