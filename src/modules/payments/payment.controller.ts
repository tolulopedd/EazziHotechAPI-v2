import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { prismaForTenant } from "../../../prisma/tenantPrisma";

export const createManualPayment = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const { bookingId } = req.params;
  const { amount, currency, reference, notes, paidAt } = req.body;

  const booking = await db.booking.findById(bookingId);
  if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

  if (!amount) throw new AppError("amount is required", 400, "VALIDATION_ERROR");

  const payment = await db.payment.create({
    data: {
      bookingId,
      method: "MANUAL",
      status: "PENDING",
      amount: String(amount), // Decimal safe (send "45000.00")
      currency: currency ?? "NGN",
      reference: reference ?? null,
      notes: notes ?? null,
      paidAt: paidAt ? new Date(paidAt) : null,
    },
  });

  res.status(201).json({ payment });
});

export const confirmPayment = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const user = (req as any).user;
  const { paymentId } = req.params;

  const payment = await db.payment.findById(paymentId);
  if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");

  if (payment.status === "CONFIRMED") {
    return res.json({ payment });
  }

  // Confirm payment
  const confirmed = await db.raw.payment.update({
    where: { id: paymentId },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      confirmedByUserId: user?.userId ?? null,
    },
  });

  // Update booking paymentStatus and optionally status
  await db.raw.booking.update({
    where: { id: confirmed.bookingId },
    data: {
      paymentStatus: "PAID",
      status: "CONFIRMED", // you can keep PENDING if you prefer
    },
  });

  res.json({ payment: confirmed });
});
