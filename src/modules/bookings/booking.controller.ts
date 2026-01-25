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

  const { unitId, status } = req.query;

  const bookings = await db.booking.findMany({
    where: {
      ...(unitId ? { unitId: String(unitId) } : {}),
      ...(status ? { status: String(status) as any } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ bookings });
});
