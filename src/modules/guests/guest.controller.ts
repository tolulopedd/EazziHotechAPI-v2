import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { prismaForTenant } from "../../../prisma/tenantPrisma";

function normalizeOptionalString(value: unknown) {
  if (value === null || value === undefined) return null;
  const next = String(value).trim();
  return next ? next : null;
}

function getParamString(value: unknown, name: string) {
  const next = Array.isArray(value) ? value[0] : value;
  const normalized = normalizeOptionalString(next);
  if (!normalized) throw new AppError(`${name} is required`, 400, "VALIDATION_ERROR");
  return normalized;
}

/**
 * GET /api/guests?q=...
 * Search guests within tenant
 */
export const listGuests = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const q = String(req.query.q || "").trim();

  const where: any = { tenantId };

  if (q) {
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { idType: { contains: q, mode: "insensitive" } },
      { idNumber: { contains: q, mode: "insensitive" } },
    ];
  }

  const guests = await db.raw.guest.findMany({
    where,
    orderBy: [{ fullName: "asc" }, { createdAt: "desc" }],
    take: 20,
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      address: true,
      nationality: true,
      idType: true,
      idNumber: true,
      idIssuedBy: true,
    },
  });

  res.json({ guests });
});

/**
 * POST /api/guests
 * Create guest (basic fields for MVP)
 */
export const createGuest = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const { fullName, email, phone, address, nationality, idType, idNumber, idIssuedBy } = req.body ?? {};

  if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
    throw new AppError("fullName is required", 400, "VALIDATION_ERROR");
  }

  const normalizedPhone = normalizeOptionalString(phone);
  const normalizedEmail = normalizeOptionalString(email);
  const normalizedAddress = normalizeOptionalString(address);
  const normalizedNationality = normalizeOptionalString(nationality);
  const normalizedIdType = normalizeOptionalString(idType);
  const normalizedIdNumber = normalizeOptionalString(idNumber);
  const normalizedIdIssuedBy = normalizeOptionalString(idIssuedBy);

  if (normalizedPhone) {
    const existing = await db.raw.guest.findFirst({
      where: { tenantId, phone: normalizedPhone },
      select: { id: true },
    });
    if (existing) {
      throw new AppError("Guest with this phone already exists", 409, "GUEST_EXISTS");
    }
  }

  if (normalizedEmail) {
    const existing = await db.raw.guest.findFirst({
      where: { tenantId, email: normalizedEmail },
      select: { id: true },
    });
    if (existing) {
      throw new AppError("Guest with this email already exists", 409, "GUEST_EXISTS");
    }
  }

  const guest = await db.raw.guest.create({
    data: {
      tenantId,
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      address: normalizedAddress,
      nationality: normalizedNationality,
      idType: normalizedIdType,
      idNumber: normalizedIdNumber,
      idIssuedBy: normalizedIdIssuedBy,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      address: true,
      nationality: true,
      idType: true,
      idNumber: true,
      idIssuedBy: true,
    },
  });

  res.status(201).json({ guest });
});

export const updateGuest = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const id = getParamString(req.params.id, "id");
  const {
    fullName,
    email,
    phone,
    address,
    nationality,
    idType,
    idNumber,
    idIssuedBy,
    vehiclePlate,
  } = req.body;

  if (!fullName || !String(fullName).trim()) {
    throw new AppError("Full name is required", 400, "VALIDATION_ERROR");
  }

  const guest = await db.raw.guest.findFirst({
    where: { id, tenantId },
  });

  if (!guest) {
    throw new AppError("Guest not found", 404, "GUEST_NOT_FOUND");
  }

  const updated = await db.raw.guest.update({
    where: { id },
    data: {
      fullName: String(fullName).trim(),
      email: normalizeOptionalString(email),
      phone: normalizeOptionalString(phone),
      address: normalizeOptionalString(address),
      nationality: normalizeOptionalString(nationality),
      idType: normalizeOptionalString(idType),
      idNumber: normalizeOptionalString(idNumber),
      idIssuedBy: normalizeOptionalString(idIssuedBy),
      vehiclePlate: normalizeOptionalString(vehiclePlate),
    },
  });

  res.json({ guest: updated });
});

export const getGuestById = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const id = getParamString(req.params.id, "id");

  const guest = await db.raw.guest.findFirst({
    where: { id, tenantId },
    include: {
      bookings: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          guestAddress: true,
          guestNationality: true,
          idType: true,
          idIssuedBy: true,
        },
      },
    },
  });

  if (!guest) throw new AppError("Guest not found", 404, "GUEST_NOT_FOUND");

  const latestBooking = guest.bookings[0];
  const guestCore = { ...guest } as any;
  delete guestCore.bookings;
  const hydratedGuest = {
    ...guestCore,
    address: guest.address ?? latestBooking?.guestAddress ?? null,
    nationality: guest.nationality ?? latestBooking?.guestNationality ?? null,
    idType: guest.idType ?? latestBooking?.idType ?? null,
    idIssuedBy: guest.idIssuedBy ?? latestBooking?.idIssuedBy ?? null,
  };

  res.json({ guest: hydratedGuest });
});
