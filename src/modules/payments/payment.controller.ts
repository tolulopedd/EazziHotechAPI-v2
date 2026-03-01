import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { prismaForTenant } from "../../../prisma/tenantPrisma";
import { AppError } from "../../common/errors/AppError";
import { resolvePropertyScope, scopedBookingWhere, scopedPaymentWhere } from "../../common/authz/property-scope";
import { logger } from "../../common/logger/logger";
import { sendGuestPaymentAcknowledgementEmail } from "../../common/notifications/email";

function computeTotalBillFromBaseAndCharges(
  baseAmount: number,
  charges: Array<{ amount: any; type?: string | null }> | null | undefined
) {
  const list = charges ?? [];
  const base = Math.max(0, Number(baseAmount || 0));

  const roomCharges = list.filter((c) => String(c.type || "").toUpperCase() === "ROOM");
  const otherCharges = list.filter((c) => String(c.type || "").toUpperCase() !== "ROOM");

  const roomTotal = roomCharges.reduce((sum, c) => sum + Number(c.amount?.toString?.() ?? c.amount ?? 0), 0);
  const otherTotal = otherCharges.reduce((sum, c) => sum + Number(c.amount?.toString?.() ?? c.amount ?? 0), 0);

  // If ROOM charge exists, use it unless legacy data undercut booking total.
  const roomComponent = roomCharges.length > 0 ? Math.max(roomTotal, base) : base;

  return Math.max(0, roomComponent + otherTotal);
}

/**
 * CONFIRMED / ALL payments list
 */
export const listPayments = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);

  const status = (req.query.status ? String(req.query.status) : undefined) as any;
  const bookingId = req.query.bookingId ? String(req.query.bookingId) : undefined;
  const q = req.query.q ? String(req.query.q).trim() : undefined;

  const where: any = {
    tenantId,
    ...scopedPaymentWhere(propertyScope),
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

/**
 * ✅ NEW: Pending (Outstanding) - bookings with remaining balance
 * Route: GET /api/payments/pending
 *
 * Returns:
 * items: [{ bookingId, guestName, unitName, bookingStatus, paymentStatus, totalAmount, paidTotal, outstanding, currency }]
 */
export const listOutstandingBookings = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);

  // Pull active-ish bookings (you can tweak this)
  const bookings = await db.raw.booking.findMany({
    where: {
      tenantId,
      ...scopedBookingWhere(propertyScope),
      status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
      // paymentStatus: { in: ["UNPAID", "PARTPAID"] }, // optional filter, but we compute anyway
    },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      currency: true,
      totalAmount: true,
      guestName: true,
      unit: { select: { name: true } },
      payments: {
        where: { status: "CONFIRMED" },
        select: { amount: true, currency: true },
      },
      charges: {
        where: { status: "OPEN" },
        select: { amount: true, currency: true, type: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200, // MVP guard; paginate later if needed
  });

  const items = bookings
    .map((b) => {
      const currency = b.currency || "NGN";
      const totalBill = computeTotalBillFromBaseAndCharges(
        Number(b.totalAmount?.toString?.() ?? b.totalAmount ?? 0),
        b.charges ?? []
      );

      // ✅ Sum CONFIRMED payments
      const paidTotal = (b.payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

      const outstanding = totalBill - paidTotal;

      return {
        bookingId: b.id,
        guestName: b.guestName ?? null,
        unitName: b.unit?.name ?? null,
        bookingStatus: b.status,
        paymentStatus: b.paymentStatus, // UNPAID | PARTPAID | PAID
        totalAmount: totalBill.toFixed(2),
        paidTotal: paidTotal.toFixed(2),
        outstanding: outstanding.toFixed(2),
        currency,
      };
    })
    // ✅ only keep bookings that truly have an outstanding balance
    .filter((x) => Number(x.outstanding) > 0.009);

  res.json({ items });
});

export const createManualPayment = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);

  const { bookingId } = req.params;
  const { amount, currency, reference, notes, paidAt } = req.body;

  const booking = await db.booking.findById(bookingId);
  if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  if (propertyScope.propertyIds !== null) {
    const scopedBooking = await db.raw.booking.findFirst({
      where: { id: bookingId, tenantId, ...scopedBookingWhere(propertyScope) },
      select: { id: true },
    });
    if (!scopedBooking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (!amount) throw new AppError("amount is required", 400, "VALIDATION_ERROR");

  const payment = await db.payment.create({
    data: {
      tenantId, // ✅ ensure tenantId is set
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
  const propertyScope = await resolvePropertyScope(req);

  const user = (req as any).user;
  const { paymentId } = req.params;

  // Load payment + booking + confirmed payments + OPEN charges
  const payment = await db.raw.payment.findFirst({
    where: { id: paymentId, tenantId, ...scopedPaymentWhere(propertyScope) },
    include: {
      booking: {
        include: {
          unit: {
            include: {
              property: { select: { address: true } },
            },
          },
          payments: { where: { status: "CONFIRMED" } },
          charges: { where: { status: "OPEN" }, select: { amount: true, type: true } }, // ✅ NEW
        },
      },
    },
  });

  if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
  if (payment.status === "CONFIRMED") return res.json({ payment });

  const booking = payment.booking;
  if (!booking) throw new AppError("Booking not found for payment", 404, "BOOKING_NOT_FOUND");
  const isFirstConfirmedPayment = (booking.payments?.length ?? 0) === 0;

  // Confirm payment
  const confirmedPayment = await db.raw.payment.update({
    where: { id: paymentId },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      confirmedByUserId: user?.userId ?? null,
    },
  });

  // fallback to booking.totalAmount, compute if missing
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

  const totalBill = computeTotalBillFromBaseAndCharges(
    Number(bookingTotal?.toString?.() ?? bookingTotal ?? 0),
    booking.charges ?? []
  );

  // Sum confirmed payments INCLUDING this one
  const alreadyConfirmed = booking.payments?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0;
  const paidTotal = alreadyConfirmed + Number(confirmedPayment.amount);

  // ✅ Use your BookingPaymentStatus enum values
  const paymentStatus =
    paidTotal >= totalBill ? "PAID" : paidTotal > 0 ? "PARTPAID" : "UNPAID";

  // Update booking (do NOT auto-set booking stay status here; keep your existing flow)
  await db.raw.booking.update({
    where: { id: booking.id },
    data: {
      paymentStatus,
    },
  });

  if (isFirstConfirmedPayment && booking.guestEmail && Number(confirmedPayment.amount ?? 0) > 0) {
    const tenantMeta = await db.raw.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true, phone: true },
    });
    sendGuestPaymentAcknowledgementEmail({
      to: String(booking.guestEmail),
      guestName: booking.guestName ?? null,
      bookingId: booking.id,
      tenantName: tenantMeta?.name ?? null,
      tenantSlug: tenantMeta?.slug ?? null,
      tenantPhone: tenantMeta?.phone ?? null,
      propertyAddress: booking?.unit?.property?.address ?? null,
      amountPaid: confirmedPayment.amount,
      paymentDate: confirmedPayment.paidAt ?? confirmedPayment.confirmedAt ?? new Date(),
      paymentMethod: confirmedPayment.method ?? "MANUAL",
      remainingBalance: Math.max(0, totalBill - paidTotal).toFixed(2),
    }).catch((err) => {
      logger.warn(
        { event: "notify.payment_ack_email_failed", tenantId, bookingId: booking.id, paymentId, error: String(err) },
        "Failed to send payment acknowledgement email"
      );
    });
  }

  res.json({
    payment: confirmedPayment,
    booking: {
      id: booking.id,
      paymentStatus,
      totalAmount: totalBill,
      paidAmount: paidTotal,
      outstanding: Math.max(0, totalBill - paidTotal),
    },
  });
});

export const deletePendingPayment = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);
  const { paymentId } = req.params;

  const payment = await db.raw.payment.findFirst({
    where: { id: paymentId, tenantId, ...scopedPaymentWhere(propertyScope) },
    select: { id: true, status: true, bookingId: true, amount: true, currency: true },
  });
  if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
  if (payment.status !== "PENDING") {
    throw new AppError("Only PENDING payments can be deleted", 400, "INVALID_STATUS");
  }

  await db.raw.payment.delete({ where: { id: paymentId } });

  res.json({
    ok: true,
    deleted: {
      id: payment.id,
      bookingId: payment.bookingId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
    },
  });
});
