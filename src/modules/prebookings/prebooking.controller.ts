import type { Request, Response } from "express";

import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { prismaForTenant } from "../../../prisma/tenantPrisma";
import { resolvePropertyScope, scopedUnitWhere } from "../../common/authz/property-scope";

function toDate(value: any, field: string) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`${field} must be a valid date`, 400, "VALIDATION_ERROR");
  }
  return d;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function unitNightlyRateForDate(unit: any, day: Date) {
  const base = Number(unit.basePrice ?? 0);
  if (!Number.isFinite(base) || base <= 0) return 0;

  if (!unit.discountType || !unit.discountValue || !unit.discountStart || !unit.discountEnd) {
    return base;
  }

  const d = startOfDay(day).getTime();
  const s = startOfDay(new Date(unit.discountStart)).getTime();
  const e = startOfDay(new Date(unit.discountEnd)).getTime();
  if (d < s || d > e) return base;

  const discountValue = Number(unit.discountValue ?? 0);
  if (!Number.isFinite(discountValue) || discountValue <= 0) return base;

  if (unit.discountType === "PERCENT") {
    const pct = Math.max(0, Math.min(100, discountValue));
    return Math.max(0, base * (1 - pct / 100));
  }
  if (unit.discountType === "FIXED_PRICE") {
    return Math.max(0, discountValue);
  }
  return base;
}

function calculateBookingTotalFromUnitRate(unit: any, checkIn: Date, checkOut: Date) {
  const s = startOfDay(checkIn);
  const e = startOfDay(checkOut);
  const nights = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
  let total = 0;
  for (let i = 0; i < nights; i += 1) {
    total += unitNightlyRateForDate(unit, addDays(s, i));
  }
  return Math.max(0, Number(total.toFixed(2)));
}

export const createPreBooking = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const { guestId, plannedCheckIn, plannedCheckOut, amountPaid, currency, notes } = req.body ?? {};

  if (!guestId || typeof guestId !== "string") {
    throw new AppError("guestId is required", 400, "VALIDATION_ERROR");
  }

  if (amountPaid === undefined || amountPaid === null || typeof amountPaid !== "string") {
    throw new AppError('amountPaid is required and must be a string like "50000.00"', 400, "VALIDATION_ERROR");
  }
  const paid = Number(amountPaid);
  if (!Number.isFinite(paid) || paid < 0) {
    throw new AppError("amountPaid must be a numeric string >= 0", 400, "VALIDATION_ERROR");
  }

  const ci = toDate(plannedCheckIn, "plannedCheckIn");
  const co = toDate(plannedCheckOut, "plannedCheckOut");
  if (!ci || !co) throw new AppError("plannedCheckIn and plannedCheckOut are required", 400, "VALIDATION_ERROR");
  if (co <= ci) throw new AppError("plannedCheckOut must be after plannedCheckIn", 400, "VALIDATION_ERROR");

  const guest = await db.raw.guest.findFirst({
    where: { id: guestId, tenantId },
    select: { id: true, fullName: true, email: true, phone: true },
  });
  if (!guest) throw new AppError("Guest not found", 404, "GUEST_NOT_FOUND");

  const preBooking = await db.raw.preBooking.create({
    data: {
      tenantId,
      guestId: guest.id,
      guestName: guest.fullName,
      guestEmail: guest.email ?? null,
      guestPhone: guest.phone ?? null,
      plannedCheckIn: ci,
      plannedCheckOut: co,
      amountPaid: amountPaid.trim(),
      currency: currency ? String(currency).trim() : "NGN",
      status: paid > 0 ? "PAID" : "PENDING",
      notes: notes ? String(notes).trim() : null,
      createdByUserId: req.user?.userId ?? null,
    },
  });

  res.status(201).json({ preBooking });
});

export const listPreBookings = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const { q, status, limit = "100" } = req.query as Record<string, string | undefined>;

  const take = Math.min(Math.max(parseInt(limit || "100", 10) || 100, 1), 200);
  const where: any = { tenantId };

  if (status && ["PENDING", "PAID", "CANCELLED", "CONVERTED"].includes(status)) {
    where.status = status;
  }

  if (q?.trim()) {
    const s = q.trim();
    where.OR = [
      { guestName: { contains: s, mode: "insensitive" } },
      { guestEmail: { contains: s, mode: "insensitive" } },
      { guestPhone: { contains: s, mode: "insensitive" } },
      { id: { contains: s, mode: "insensitive" } },
    ];
  }

  const preBookings = await db.raw.preBooking.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      guest: { select: { id: true, fullName: true, email: true, phone: true } },
    },
  });

  res.json({ preBookings });
});

export const convertPreBooking = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);
  const preBookingId = req.params.id;

  const { unitId, checkIn, checkOut, totalAmount, currency } = req.body ?? {};
  if (!unitId) throw new AppError("unitId is required", 400, "VALIDATION_ERROR");

  const start = toDate(checkIn, "checkIn");
  const end = toDate(checkOut, "checkOut");
  if (!start || !end || end <= start) {
    throw new AppError("checkIn/checkOut are required and checkOut must be after checkIn", 400, "VALIDATION_ERROR");
  }

  const result = await db.raw.$transaction(async (tx) => {
    const pre = await tx.preBooking.findFirst({
      where: { id: preBookingId, tenantId },
    });
    if (!pre) throw new AppError("Pre-booking not found", 404, "PREBOOKING_NOT_FOUND");
    if (pre.status === "CONVERTED" || pre.convertedBookingId) {
      throw new AppError("Pre-booking already converted", 409, "PREBOOKING_ALREADY_CONVERTED");
    }
    if (pre.status === "CANCELLED") {
      throw new AppError("Cancelled pre-booking cannot be converted", 409, "PREBOOKING_CANCELLED");
    }

    const unit = await tx.unit.findFirst({
      where: { id: String(unitId), tenantId, ...scopedUnitWhere(propertyScope) },
      select: {
        id: true,
        basePrice: true,
        discountType: true,
        discountValue: true,
        discountStart: true,
        discountEnd: true,
      },
    });
    if (!unit) throw new AppError("Unit not found", 404, "UNIT_NOT_FOUND");

    const conflict = await tx.booking.findMany({
      where: {
        unitId: String(unitId),
        tenantId,
        status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
        AND: [{ checkIn: { lt: end } }, { checkOut: { gt: start } }],
      },
      take: 1,
    });
    if (conflict.length > 0) {
      throw new AppError("Unit is not available for the selected dates", 409, "UNIT_NOT_AVAILABLE");
    }

    const calculatedTotal = calculateBookingTotalFromUnitRate(unit, start, end);
    const bookingTotalAmount =
      totalAmount !== undefined && totalAmount !== null && String(totalAmount).trim()
        ? String(totalAmount).trim()
        : calculatedTotal.toFixed(2);

    const totalBillNum = Number(bookingTotalAmount);
    if (!Number.isFinite(totalBillNum) || totalBillNum <= 0) {
      throw new AppError("Booking total must be greater than 0", 400, "VALIDATION_ERROR");
    }

    const guest = await tx.guest.findFirst({
      where: { id: pre.guestId, tenantId },
      select: { id: true, fullName: true, email: true, phone: true },
    });
    if (!guest) throw new AppError("Guest not found for this pre-booking", 404, "GUEST_NOT_FOUND");
    const guestEmail = guest.email?.trim() || null;
    const guestPhone = guest.phone?.trim() || null;

    const booking = await tx.booking.create({
      data: {
        tenantId,
        unitId: String(unitId),
        guestId: guest.id,
        checkIn: start,
        checkOut: end,
        guestName: pre.guestName,
        guestEmail,
        guestPhone,
        totalAmount: bookingTotalAmount,
        currency: currency ? String(currency).trim() : pre.currency || "NGN",
        status: "PENDING",
        paymentStatus: "UNPAID",
      },
      include: {
        guest: { select: { id: true, fullName: true, email: true, phone: true } },
      },
    });

    await tx.bookingCharge.create({
      data: {
        tenantId,
        bookingId: booking.id,
        type: "ROOM",
        title: "Room charge",
        amount: bookingTotalAmount,
        currency: booking.currency,
        status: "OPEN",
      },
    });

    const prePaid = Number(pre.amountPaid?.toString?.() ?? pre.amountPaid ?? 0);
    let paidTotal = 0;
    if (prePaid > 0) {
      await tx.payment.create({
        data: {
          tenantId,
          bookingId: booking.id,
          amount: pre.amountPaid,
          currency: booking.currency,
          reference: `PRE-${pre.id.slice(0, 8).toUpperCase()}`,
          notes: `Applied from pre-booking ${pre.id.slice(0, 8)}`,
          method: "MANUAL",
          status: "CONFIRMED",
          paidAt: new Date(),
          confirmedAt: new Date(),
          confirmedByUserId: req.user?.userId ?? null,
        },
      });
      paidTotal = prePaid;
    }

    const outstanding = Math.max(0, totalBillNum - paidTotal);
    const nextPaymentStatus = paidTotal <= 0 ? "UNPAID" : outstanding > 0.009 ? "PARTPAID" : "PAID";

    const updatedBooking = await tx.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus: nextPaymentStatus,
        status: nextPaymentStatus === "UNPAID" ? "PENDING" : "CONFIRMED",
      },
    });

    const updatedPre = await tx.preBooking.update({
      where: { id: pre.id },
      data: {
        status: "CONVERTED",
        convertedBookingId: booking.id,
        convertedAt: new Date(),
      },
    });

    return {
      booking: updatedBooking,
      preBooking: updatedPre,
      paidApplied: paidTotal.toFixed(2),
      outstanding: outstanding.toFixed(2),
    };
  });

  res.json(result);
});

export const cancelPreBooking = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const id = req.params.id;

  const pre = await db.raw.preBooking.findFirst({ where: { id, tenantId } });
  if (!pre) throw new AppError("Pre-booking not found", 404, "PREBOOKING_NOT_FOUND");
  if (pre.status === "CONVERTED") {
    throw new AppError("Converted pre-booking cannot be cancelled", 409, "PREBOOKING_ALREADY_CONVERTED");
  }

  const preBooking = await db.raw.preBooking.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  res.json({ preBooking });
});
