import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { prismaForTenant } from "../../../prisma/tenantPrisma";

function toDate(value: any, field: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError(`${field} must be a valid date`, 400, "VALIDATION_ERROR");
  return d;
}

export const createBooking = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const { unitId, checkIn, checkOut, guestName, guestEmail, guestPhone } = req.body;
  if (!unitId) throw new AppError("unitId is required", 400, "VALIDATION_ERROR");

  const start = toDate(checkIn, "checkIn");
  const end = toDate(checkOut, "checkOut");
  if (end <= start) throw new AppError("checkOut must be after checkIn", 400, "VALIDATION_ERROR");

  // Ensure unit belongs to tenant
  const unit = await db.unit.findById(unitId);
  if (!unit) throw new AppError("Unit not found", 404, "UNIT_NOT_FOUND");

  // Overlap check:
  // Overlap exists if: existing.checkIn < newCheckOut AND existing.checkOut > newCheckIn
  const conflict = await db.booking.findMany({
    where: {
      unitId,
      status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
      AND: [
        { checkIn: { lt: end } },
        { checkOut: { gt: start } },
      ],
    },
    take: 1,
  });

  if (conflict.length > 0) {
    throw new AppError("Unit is not available for the selected dates", 409, "UNIT_NOT_AVAILABLE");
  }

  const booking = await db.booking.create({
    data: {
      unitId,
      checkIn: start,
      checkOut: end,
      guestName: guestName ?? null,
      guestEmail: guestEmail ?? null,
      guestPhone: guestPhone ?? null,
      status: "PENDING",
      paymentStatus: "UNPAID",
    },
  });

  res.status(201).json({ booking });
});

export const listBookings = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const {
    unitId,
    status,
    paymentStatus,
    from,
    to,
    q,
    limit = "50",
    cursor,
  } = req.query as Record<string, string | undefined>;

  const take = Math.min(parseInt(limit, 10) || 50, 200);

  const where: any = {
    ...(unitId ? { unitId } : {}),
    ...(status ? { status } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
  };

  // Date filtering (check-in range)
  if (from || to) {
    where.checkIn = {
      ...(from ? { gte: toDate(from, "from") } : {}),
      ...(to ? { lte: toDate(to, "to") } : {}),
    };
  }

  // Simple search on guest details
  if (q?.trim()) {
    where.OR = [
      { guestName: { contains: q.trim(), mode: "insensitive" } },
      { guestEmail: { contains: q.trim(), mode: "insensitive" } },
    ];
  }

  const bookings = await db.booking.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  res.json({ bookings });
});

export const arrivalsToday = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const bookings = await db.raw.booking.findMany({
    where: {
      tenantId,
      status: "CONFIRMED",
      checkIn: { gte: start, lte: end },
    },
    include: {
      unit: {
        select: {
          id: true,
          name: true,
          type: true,
          property: { select: { name: true } },
        },
      },
    },
    orderBy: { checkIn: "asc" },
  });

  res.json({ bookings });
});

export const inHouse = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const search = String(req.query.search || "").trim();

  const bookings = await db.raw.booking.findMany({
    where: {
      tenantId,
      status: "CHECKED_IN",
      ...(search
        ? {
            OR: [
              { guestName: { contains: search, mode: "insensitive" } },
              { guestPhone: { contains: search, mode: "insensitive" } },
              { guestEmail: { contains: search, mode: "insensitive" } },
              { unit: { name: { contains: search, mode: "insensitive" } } },
              { unit: { property: { name: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: {
      unit: {
        select: {
          name: true,
          type: true,
          property: { select: { name: true } },
        },
      },
    },
    orderBy: { checkedInAt: "desc" },
  });

  res.json({ bookings });
});
