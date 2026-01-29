import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { prismaForTenant } from "../../../prisma/tenantPrisma";

/**
 * CHECK-IN
 */
export const checkIn = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const user = (req as any).user;

  const { bookingId } = req.params;
  const { photoUrl, idDocUrl, notes } = req.body;

  const result = await db.raw.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
    }

    if (booking.status !== "CONFIRMED") {
      throw new AppError(
        "Booking must be CONFIRMED before check-in",
        409,
        "INVALID_BOOKING_STATE"
      );
    }

    // 🚫 prevent unit double-occupancy
    const clash = await tx.booking.findFirst({
      where: {
        unitId: booking.unitId,
        status: "CHECKED_IN",
        NOT: { id: bookingId },
      },
      select: { id: true },
    });

    if (clash) {
      throw new AppError("Unit is already occupied", 409, "UNIT_ALREADY_OCCUPIED");
    }

    // 1) tenant settings
    const settings = await tx.tenantSettings.findUnique({
      where: { tenantId },
    });
    const minDepositPercent = settings?.minDepositPercent ?? 100;

    // 2) booking amount
    if (!booking.totalAmount) {
      throw new AppError(
        "Booking totalAmount not set",
        409,
        "BOOKING_AMOUNT_REQUIRED"
      );
    }

    // 3) payments
    const confirmedPayments = await tx.payment.findMany({
      where: { bookingId, status: "CONFIRMED" },
    });

    const paidAmount = confirmedPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );

    const totalAmount = Number(booking.totalAmount);
    const requiredDeposit = (minDepositPercent / 100) * totalAmount;

    if (paidAmount < requiredDeposit) {
      throw new AppError(
        `Deposit required: ${minDepositPercent}%`,
        409,
        "DEPOSIT_REQUIRED"
      );
    }

    const paymentStatus =
      paidAmount >= totalAmount
        ? "PAID"
        : paidAmount > 0
        ? "PARTPAID"
        : "UNPAID";

    // ✅ update booking atomically
    const updatedBooking = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "CHECKED_IN",
        checkedInAt: new Date(),
        paymentStatus,
      },
    });

    // ✅ audit event
    const event = await tx.checkEvent.create({
      data: {
        tenantId,
        bookingId,
        type: "CHECK_IN",
        capturedByUserId: user?.userId ?? null,
        photoUrl: photoUrl ?? null,
        idDocUrl: idDocUrl ?? null,
        verificationMode: "MANUAL_REVIEW",
        verificationResult: "PENDING",
        notes: notes ?? null,
      },
    });

    return { booking: updatedBooking, checkIn: event };
  });

  res.status(201).json(result);
});

/**
 * CHECK-OUT
 */
export const checkOut = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const user = (req as any).user;

  const { bookingId } = req.params;
  const { photoUrl, notes } = req.body;

  const result = await db.raw.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
    }

    if (booking.status !== "CHECKED_IN") {
      throw new AppError(
        "Booking must be CHECKED_IN before check-out",
        409,
        "INVALID_BOOKING_STATE"
      );
    }

    const updatedBooking = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "CHECKED_OUT",
        checkedOutAt: new Date(),
      },
    });

    const event = await tx.checkEvent.create({
      data: {
        tenantId,
        bookingId,
        type: "CHECK_OUT",
        capturedByUserId: user?.userId ?? null,
        photoUrl: photoUrl ?? null,
        verificationMode: "MANUAL_REVIEW",
        verificationResult: "PENDING",
        notes: notes ?? null,
      },
    });

    return { booking: updatedBooking, checkOut: event };
  });

  res.status(201).json(result);
});
