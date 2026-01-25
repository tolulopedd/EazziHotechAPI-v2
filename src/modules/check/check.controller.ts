import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { prismaForTenant } from "../../../prisma/tenantPrisma";

export const checkIn = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const user = (req as any).user;
  const { bookingId } = req.params;
  const { photoUrl, idDocUrl, notes } = req.body;

  const booking = await db.booking.findById(bookingId);
  if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  if (booking.status !== "CONFIRMED") throw new AppError("Booking must be CONFIRMED before check-in", 409, "INVALID_BOOKING_STATE");

// 1) Load tenant settings
const settings = await db.raw.tenantSettings.findUnique({
  where: { tenantId },
});
const minDepositPercent = settings?.minDepositPercent ?? 100;

// 2) totalAmount is required for deposit policy
if (!booking.totalAmount) {
  throw new AppError("Booking totalAmount not set", 409, "BOOKING_AMOUNT_REQUIRED");
}

// 3) Sum confirmed payments
const confirmedPayments = await db.payment.findMany({
  where: { bookingId, status: "CONFIRMED" },
});

const paidAmount = confirmedPayments.reduce((sum, p) => sum + Number(p.amount), 0);
const totalAmount = Number(booking.totalAmount);

const requiredDeposit = (minDepositPercent / 100) * totalAmount;

if (paidAmount < requiredDeposit) {
  throw new AppError(
    `Deposit required: ${minDepositPercent}%`,
    409,
    "DEPOSIT_REQUIRED"
  );
}

// Optional: update booking.paymentStatus based on paidAmount
const paymentStatus =
  paidAmount >= totalAmount ? "PAID" : paidAmount > 0 ? "PARTPAID" : "UNPAID";

await db.raw.booking.update({
  where: { id: bookingId },
  data: { paymentStatus },
});


  const event = await db.checkEvent.create({
    data: {
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

await db.booking.updateById(bookingId, { status: "CHECKED_IN" });

  res.status(201).json({ checkIn: event });
});

export const checkOut = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const user = (req as any).user;
  const { bookingId } = req.params;
  const { photoUrl, notes } = req.body;

  const booking = await db.booking.findById(bookingId);
  if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  if (booking.status !== "CHECKED_IN") throw new AppError("Booking must be CHECKED_IN before check-out", 409, "INVALID_BOOKING_STATE");

  const event = await db.checkEvent.create({
    data: {
      bookingId,
      type: "CHECK_OUT",
      capturedByUserId: user?.userId ?? null,
      photoUrl: photoUrl ?? null,
      verificationMode: "MANUAL_REVIEW",
      verificationResult: "PENDING",
      notes: notes ?? null,
    },
  });

await db.booking.updateById(bookingId, { status: "CHECKED_OUT" });


  res.status(201).json({ checkOut: event });
});
