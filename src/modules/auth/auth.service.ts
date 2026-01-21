import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";

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
