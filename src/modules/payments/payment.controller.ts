import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { prismaForTenant } from "../../../prisma/tenantPrisma";
import { AppError } from "../../common/errors/AppError";

export const listPayments = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const status = (req.query.status ? String(req.query.status) : undefined) as any;
  const bookingId = req.query.bookingId ? String(req.query.bookingId) : undefined;
  const q = req.query.q ? String(req.query.q).trim() : undefined;

  const where: any = {
     tenantId, // ✅ add this
    ...(status ? { status } : {}),
    ...(bookingId ? { bookingId } : {}),
    ...(q
      ? {
          OR: [
            { reference: { contains: q, mode: "insensitive" } },
            { currency: { contains: q, mode: "insensitive" } },
            { booking: { guestName: { contains: q, mode: "insensitive" } } },
            { booking: { guestEmail: { contains: q, mode: "insensitive" } } },
            { bookingId: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const payments = await db.raw.payment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      booking: {
        select: {
          id: true,
          unitId: true,
          status: true,
          paymentStatus: true,
          checkIn: true,
          checkOut: true,
          guestName: true,
          guestEmail: true,
      
          unit: { select: { id: true, name: true } },
        },
      },
    },
  });

  res.json({ payments });
});

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
      amount: String(amount),
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

  // Load payment + booking + confirmed payments
  const payment = await db.raw.payment.findFirst({
    where: { id: paymentId, tenantId },
    include: {
      booking: {
        include: {
          unit: true,
          payments: { where: { status: "CONFIRMED" } },
        },
      },
    },
  });

  if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
  if (payment.status === "CONFIRMED") return res.json({ payment });

  const booking = payment.booking;
  if (!booking) throw new AppError("Booking not found for payment", 404, "BOOKING_NOT_FOUND");

  // Confirm payment
  const confirmedPayment = await db.raw.payment.update({
    where: { id: paymentId },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      confirmedByUserId: user?.userId ?? null,
    },
  });

  // Ensure booking totalAmount exists (compute if missing)
  let bookingTotal = booking.totalAmount;

  if (!bookingTotal) {
    if (!booking.unit?.basePrice) {
      throw new AppError("Cannot compute booking total (unit price missing)", 400, "BOOKING_TOTAL_MISSING");
    }

    const nights =
      Math.ceil((booking.checkOut.getTime() - booking.checkIn.getTime()) / (1000 * 60 * 60 * 24)) || 1;

    bookingTotal = booking.unit.basePrice.mul(nights);

    await db.raw.booking.update({
      where: { id: booking.id },
      data: {
        totalAmount: bookingTotal,
        currency: booking.currency ?? "NGN",
      },
    });
  }

  // Sum confirmed payments INCLUDING this one
  const paidTotal = booking.payments.reduce((sum, p) => sum.add(p.amount), confirmedPayment.amount);

  // Determine status
  let paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" = "UNPAID";
  if (paidTotal.greaterThanOrEqualTo(bookingTotal)) paymentStatus = "PAID";
  else if (paidTotal.greaterThan(0)) paymentStatus = "PARTIALLY_PAID";

  // Update booking
  await db.raw.booking.update({
    where: { id: booking.id },
    data: {
      paymentStatus,
      status: paymentStatus === "PAID" ? "CONFIRMED" : booking.status,
    },
  });

  res.json({
    payment: confirmedPayment,
    booking: {
      id: booking.id,
      paymentStatus,
      totalAmount: bookingTotal,
      paidAmount: paidTotal,
    },
  });
});
