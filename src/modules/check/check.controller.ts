import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { prismaForTenant } from "../../../prisma/tenantPrisma";
import { logger } from "../../common/logger/logger";
import {
  sendAdminCheckInAlertEmail,
  sendAdminCheckOutAlertEmail,
  sendGuestCheckInEmail,
  sendGuestCheckOutEmail,
} from "../../common/notifications/email";
import { resolvePropertyScope, scopedBookingWhere } from "../../common/authz/property-scope";

function toOptionalString(value: unknown) {
  if (value === null || value === undefined) return null;
  const next = String(value).trim();
  return next ? next : null;
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
  }
  return false;
}

function computeTotalBillFromBaseAndCharges(
  baseAmount: number,
  charges: Array<{ amount: any; type?: string | null }> | null | undefined
) {
  const list = charges ?? [];
  const chargesTotal = list.reduce((sum, c) => sum + Number(c.amount?.toString?.() ?? c.amount ?? 0), 0);
  const hasRoomCharge = list.some((c) => String(c.type || "").toUpperCase() === "ROOM");
  return hasRoomCharge ? chargesTotal : Math.max(0, baseAmount) + chargesTotal;
}

/**
 * CHECK-IN
 */
export const checkIn = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const user = (req as any).user;
  const propertyScope = await resolvePropertyScope(req);

  const { bookingId } = req.params;
  const { photoUrl, idDocUrl, notes } = req.body;
  if (!bookingId) throw new AppError("bookingId is required", 400, "VALIDATION_ERROR");

  const result = await db.raw.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({ where: { id: bookingId, tenantId, ...scopedBookingWhere(propertyScope) } });
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
        tenantId,
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
      where: { tenantId, bookingId, status: "CONFIRMED" },
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

  logger.info(
    {
      event: "audit.check_in",
      requestId: req.requestId,
      tenantId,
      bookingId,
      actorUserId: user?.userId ?? null,
      status: result.booking.status,
      paymentStatus: result.booking.paymentStatus,
    },
    "Audit check-in"
  );

  const checkInNotifyBooking = await db.raw.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: {
      id: true,
      guestName: true,
      guestEmail: true,
      checkIn: true,
      checkOut: true,
      totalAmount: true,
      currency: true,
      unit: { select: { name: true, property: { select: { name: true, address: true } } } },
    },
  });
  const tenantMeta = await db.raw.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, slug: true, email: true },
  });
  if (checkInNotifyBooking?.guestEmail) {
    sendGuestCheckInEmail({
      to: String(checkInNotifyBooking.guestEmail),
      guestName: checkInNotifyBooking.guestName ?? null,
      bookingId: checkInNotifyBooking.id,
      tenantName: tenantMeta?.name ?? null,
      tenantSlug: tenantMeta?.slug ?? null,
      supportEmail: tenantMeta?.email ?? null,
      propertyName: checkInNotifyBooking?.unit?.property?.name ?? null,
      propertyAddress: checkInNotifyBooking?.unit?.property?.address ?? null,
      unitName: checkInNotifyBooking?.unit?.name ?? null,
      checkIn: checkInNotifyBooking.checkIn,
      checkOut: checkInNotifyBooking.checkOut,
      totalAmount: checkInNotifyBooking.totalAmount?.toString?.() ?? checkInNotifyBooking.totalAmount ?? null,
      currency: checkInNotifyBooking.currency ?? "NGN",
    }).catch((err) => {
      logger.warn(
        { event: "notify.checkin_email_failed", tenantId, bookingId, error: String(err) },
        "Failed to send check-in email"
      );
    });
  }

  const checkInAdminRecipients = await db.raw.user.findMany({
    where: { tenantId, role: "ADMIN", status: "ACTIVE" },
    select: { email: true },
  });

  for (const admin of checkInAdminRecipients) {
    const to = String(admin.email || "").trim();
    if (!to) continue;
    sendAdminCheckInAlertEmail({
      to,
      guestName: checkInNotifyBooking?.guestName ?? null,
      bookingId: checkInNotifyBooking?.id ?? bookingId,
      tenantName: tenantMeta?.name ?? null,
      tenantSlug: tenantMeta?.slug ?? null,
      supportEmail: tenantMeta?.email ?? null,
      propertyName: checkInNotifyBooking?.unit?.property?.name ?? null,
      propertyAddress: checkInNotifyBooking?.unit?.property?.address ?? null,
      unitName: checkInNotifyBooking?.unit?.name ?? null,
      checkIn: checkInNotifyBooking?.checkIn,
      checkOut: checkInNotifyBooking?.checkOut,
      totalAmount: checkInNotifyBooking?.totalAmount?.toString?.() ?? checkInNotifyBooking?.totalAmount ?? null,
      currency: checkInNotifyBooking?.currency ?? "NGN",
    }).catch((err) => {
      logger.warn(
        { event: "notify.checkin_admin_email_failed", tenantId, bookingId, adminEmail: to, error: String(err) },
        "Failed to send admin check-in alert email"
      );
    });
  }

  res.status(201).json(result);
});

/**
 * CHECK-OUT (blocked if outstanding > 0)
 */
export const checkOut = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const user = (req as any).user;
  const propertyScope = await resolvePropertyScope(req);

  const { bookingId } = req.params;
  const { photoUrl, notes, damagesCost, damagesNotes, refundPolicy, refundApproved, refundAmount, refundReason } =
    req.body ?? {};
  if (!bookingId) throw new AppError("bookingId is required", 400, "VALIDATION_ERROR");

  const parsedDamagesCost = Number(damagesCost ?? 0);
  const normalizedDamagesCost = Number.isFinite(parsedDamagesCost) ? Math.max(0, parsedDamagesCost) : 0;
  const normalizedRefundPolicy = toOptionalString(refundPolicy);
  const normalizedRefundReason = toOptionalString(refundReason);
  const normalizedRefundApproved = toBoolean(refundApproved);
  const parsedRefundAmount = Number(refundAmount ?? 0);
  const normalizedRefundAmount =
    Number.isFinite(parsedRefundAmount) && parsedRefundAmount > 0 ? parsedRefundAmount : 0;

  const booking = await db.raw.booking.findFirst({
    where: { id: bookingId, tenantId, ...scopedBookingWhere(propertyScope) },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      currency: true,
      guestName: true,
      guestEmail: true,
      checkIn: true,
      checkOut: true,
      unit: { select: { name: true, property: { select: { name: true, address: true } } } },
    },
  });

  if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

  if (booking.status !== "CHECKED_IN") {
    throw new AppError("Booking must be CHECKED_IN before check-out", 409, "INVALID_BOOKING_STATE");
  }

  // Persist/update damage charge first, so it remains even when checkout is blocked by outstanding balance.
  if (normalizedDamagesCost > 0) {
    const existingDamageCharge = await db.raw.bookingCharge.findFirst({
      where: {
        tenantId,
        bookingId,
        type: "DAMAGE",
        status: "OPEN",
        title: "Checkout damage charge",
      },
      select: { id: true },
    });

    if (existingDamageCharge) {
      await db.raw.bookingCharge.update({
        where: { id: existingDamageCharge.id },
        data: {
          amount: normalizedDamagesCost.toFixed(2),
          currency: booking.currency ?? "NGN",
        },
      });
    } else {
      await db.raw.bookingCharge.create({
        data: {
          tenantId,
          bookingId,
          type: "DAMAGE",
          title: "Checkout damage charge",
          amount: normalizedDamagesCost.toFixed(2),
          currency: booking.currency ?? "NGN",
          status: "OPEN",
        },
      });
    }
  }

  const openCharges = await db.raw.bookingCharge.findMany({
    where: { tenantId, bookingId, status: "OPEN" },
    select: { amount: true, type: true },
  });

  const totalBill = computeTotalBillFromBaseAndCharges(
    Number(booking.totalAmount?.toString?.() ?? booking.totalAmount ?? 0),
    openCharges
  );

  // paid total = CONFIRMED payments sum
  const paymentsAgg = await db.raw.payment.aggregate({
    where: { tenantId, bookingId, status: "CONFIRMED" },
    _sum: { amount: true },
  });

  const paidTotal = Number(paymentsAgg._sum.amount ?? 0);
  const outstanding = totalBill - paidTotal;
  const now = new Date();
  const isEarlyCheckout = booking.checkOut > now;
  const bookedNights = Math.max(
    1,
    Math.ceil((booking.checkOut.getTime() - booking.checkIn.getTime()) / (1000 * 60 * 60 * 24))
  );
  const usedNights = Math.max(
    1,
    Math.min(bookedNights, Math.ceil((now.getTime() - booking.checkIn.getTime()) / (1000 * 60 * 60 * 24)))
  );
  const unusedNights = Math.max(0, bookedNights - usedNights);
  const baseAmount = Number(booking.totalAmount ?? 0);
  const nightlyRate = bookedNights > 0 ? baseAmount / bookedNights : 0;
  const refundEligibleAmount = isEarlyCheckout ? Math.max(0, unusedNights * nightlyRate) : 0;

  if (outstanding > 0.009) {
    const currency = booking.currency ?? "NGN";
    throw new AppError(
      `Outstanding balance must be settled before checkout: ${currency} ${outstanding.toFixed(2)}`,
      409,
      "OUTSTANDING_BALANCE"
    );
  }

  const result = await db.raw.$transaction(async (tx) => {
    const updatedBooking = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "CHECKED_OUT",
        checkedOutAt: new Date(),
        paymentStatus: "PAID",
        earlyCheckout: isEarlyCheckout,
        earlyCheckoutAt: isEarlyCheckout ? now : null,
        refundPolicy: normalizedRefundPolicy,
        refundEligibleAmount: refundEligibleAmount > 0 ? refundEligibleAmount.toFixed(2) : null,
        refundApproved: normalizedRefundApproved,
        refundAmount: normalizedRefundAmount > 0 ? normalizedRefundAmount.toFixed(2) : null,
        refundStatus: normalizedRefundApproved ? "PENDING" : "NOT_APPROVED",
        refundReason: normalizedRefundReason,
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
        notes: [notes, damagesNotes ? `Damage note: ${String(damagesNotes).trim()}` : null]
          .filter(Boolean)
          .join(" | ") || null,
        earlyCheckout: isEarlyCheckout,
        refundPolicy: normalizedRefundPolicy,
        refundEligibleAmount: refundEligibleAmount > 0 ? refundEligibleAmount.toFixed(2) : null,
        refundApproved: normalizedRefundApproved,
        refundAmount: normalizedRefundAmount > 0 ? normalizedRefundAmount.toFixed(2) : null,
        refundStatus: normalizedRefundApproved ? "PENDING" : "NOT_APPROVED",
        refundReason: normalizedRefundReason,
      },
    });

    return {
      booking: updatedBooking,
      checkOut: event,
      settlement: {
        totalBill,
        paidTotal,
        outstanding: Math.max(0, outstanding),
        currency: booking.currency ?? "NGN",
        earlyCheckout: isEarlyCheckout,
        refundPolicy: normalizedRefundPolicy,
        refundEligibleAmount: Number(refundEligibleAmount.toFixed(2)),
        refundApproved: normalizedRefundApproved,
        refundAmount: normalizedRefundAmount,
      },
    };
  });

  logger.info(
    {
      event: "audit.check_out",
      requestId: req.requestId,
      tenantId,
      bookingId,
      actorUserId: user?.userId ?? null,
      settlement: result.settlement,
      damagesCost: normalizedDamagesCost,
    },
    "Audit check-out"
  );
  const checkoutTenantMeta = await db.raw.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, slug: true, email: true },
  });

  if (booking.guestEmail) {
    sendGuestCheckOutEmail({
      to: String(booking.guestEmail),
      guestName: booking.guestName ?? null,
      bookingId: booking.id,
      tenantName: checkoutTenantMeta?.name ?? null,
      tenantSlug: checkoutTenantMeta?.slug ?? null,
      supportEmail: checkoutTenantMeta?.email ?? null,
      propertyName: booking?.unit?.property?.name ?? null,
      propertyAddress: booking?.unit?.property?.address ?? null,
      unitName: booking?.unit?.name ?? null,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      totalAmount: booking.totalAmount?.toString?.() ?? booking.totalAmount ?? null,
      currency: booking.currency ?? "NGN",
    }).catch((err) => {
      logger.warn(
        { event: "notify.checkout_email_failed", tenantId, bookingId, error: String(err) },
        "Failed to send check-out email"
      );
    });
  }

  const checkOutAdminRecipients = await db.raw.user.findMany({
    where: { tenantId, role: "ADMIN", status: "ACTIVE" },
    select: { email: true },
  });

  for (const admin of checkOutAdminRecipients) {
    const to = String(admin.email || "").trim();
    if (!to) continue;
    sendAdminCheckOutAlertEmail({
      to,
      guestName: booking.guestName ?? null,
      bookingId: booking.id,
      tenantName: checkoutTenantMeta?.name ?? null,
      tenantSlug: checkoutTenantMeta?.slug ?? null,
      supportEmail: checkoutTenantMeta?.email ?? null,
      propertyName: booking?.unit?.property?.name ?? null,
      propertyAddress: booking?.unit?.property?.address ?? null,
      unitName: booking?.unit?.name ?? null,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      totalAmount: booking.totalAmount?.toString?.() ?? booking.totalAmount ?? null,
      currency: booking.currency ?? "NGN",
    }).catch((err) => {
      logger.warn(
        { event: "notify.checkout_admin_email_failed", tenantId, bookingId, adminEmail: to, error: String(err) },
        "Failed to send admin check-out alert email"
      );
    });
  }

  res.status(201).json(result);
});

/**
 * MANUAL OVERSTAY CHARGE
 */
export const addOverstayCharge = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);
  const { bookingId } = req.params;
  const { amount, notes, title } = req.body ?? {};
  if (!bookingId) throw new AppError("bookingId is required", 400, "VALIDATION_ERROR");

  const parsedAmount = Number(amount ?? 0);
  const normalizedAmount = Number.isFinite(parsedAmount) ? Math.max(0, parsedAmount) : 0;
  if (normalizedAmount <= 0) {
    throw new AppError("amount must be greater than 0", 400, "VALIDATION_ERROR");
  }

  const booking = await db.raw.booking.findFirst({
    where: { id: bookingId, tenantId, ...scopedBookingWhere(propertyScope) },
    select: {
      id: true,
      status: true,
      checkOut: true,
      currency: true,
    },
  });

  if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  if (booking.status !== "CHECKED_IN") {
    throw new AppError("Booking must be CHECKED_IN to add overstay charge", 409, "INVALID_BOOKING_STATE");
  }
  if (booking.checkOut >= new Date()) {
    throw new AppError("Overstay charge allowed only after scheduled checkout date", 409, "NOT_OVERSTAYED");
  }

  const chargeTitle = toOptionalString(title) || `Overstay night - ${new Date().toISOString().slice(0, 10)}`;
  const charge = await db.raw.bookingCharge.create({
    data: {
      tenantId,
      bookingId,
      type: "EXTRA",
      title: chargeTitle,
      amount: normalizedAmount.toFixed(2),
      currency: booking.currency ?? "NGN",
      status: "OPEN",
    },
  });

  logger.info(
    {
      event: "audit.overstay_charge_added",
      requestId: req.requestId,
      tenantId,
      bookingId,
      amount: normalizedAmount,
      notes: toOptionalString(notes),
      chargeId: charge.id,
    },
    "Audit overstay charge"
  );

  res.status(201).json({ charge });
});
