import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { prismaForTenant } from "../../../prisma/tenantPrisma";

function computeTotalBillFromBaseAndCharges(
  baseAmount: number,
  charges: Array<{ amount: any; type?: string | null }> | null | undefined
) {
  const list = charges ?? [];
  const chargesTotal = list.reduce((sum, c) => sum + Number(c.amount?.toString?.() ?? c.amount ?? 0), 0);
  const hasRoomCharge = list.some((c) => String(c.type || "").toUpperCase() === "ROOM");
  return hasRoomCharge ? chargesTotal : Math.max(0, baseAmount) + chargesTotal;
}

/* ================= CSV HELPERS ================= */

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Record<string, any>[], headers: string[]) {
  const head = headers.join(",");
  const body = rows
    .map((r) => headers.map((h) => csvEscape(r[h])).join(","))
    .join("\n");
  return `${head}\n${body}\n`;
}

/* ================= DATE HELPERS ================= */

function toDateOnly(value: any, field: string) {
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    throw new AppError(`${field} must be a valid date`, 400, "VALIDATION_ERROR");
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    throw new AppError(`${field} must be a valid date`, 400, "VALIDATION_ERROR");
  }

  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function isoDay(d: Date) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}

/* ================= BUILDER (SINGLE SOURCE OF TRUTH) ================= */

async function buildBookingsPaymentsReport(req: Request) {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const fromQ = String(req.query.from || "");
  const toQ = String(req.query.to || "");

  // Default: last 30 days
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const from = fromQ ? toDateOnly(fromQ, "from") : addDays(today, -29);
  const to = toQ ? toDateOnly(toQ, "to") : today;
  if (from > to) {
    throw new AppError("from must be before or equal to to", 400, "VALIDATION_ERROR");
  }
  const toExclusive = addDays(to, 1);

  const includeCancelled = String(req.query.includeCancelled || "false") === "true";
  const propertyId = String(req.query.propertyId || "").trim();
  const unitId = String(req.query.unitId || "").trim();
  const bookingScope: any = {
    ...(includeCancelled ? {} : { status: { notIn: ["CANCELLED", "NO_SHOW"] } }),
    ...(unitId ? { unitId } : {}),
    ...(propertyId ? { unit: { propertyId } } : {}),
  };

  const bookingWhere: any = {
    tenantId,
    createdAt: { gte: from, lt: toExclusive },
    ...bookingScope,
  };

  const bookings = await db.raw.booking.findMany({
    where: bookingWhere,
    select: {
      id: true,
      createdAt: true,
      status: true,
      paymentStatus: true,
      totalAmount: true,
      currency: true,
      checkedInAt: true,
      guestName: true,
      unit: {
        select: {
          id: true,
          name: true,
          property: { select: { id: true, name: true } },
        },
      },
      charges: {
        where: { status: "OPEN" },
        select: { amount: true, type: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const bookingIds = bookings.map((b) => b.id);
  const paymentsInRange =
    bookingIds.length === 0
      ? []
      : await db.raw.payment.findMany({
          where: {
            tenantId,
            status: "CONFIRMED",
            bookingId: { in: bookingIds },
            paidAt: { gte: from, lt: toExclusive },
          },
          select: {
            id: true,
            bookingId: true,
            amount: true,
            currency: true,
            paidAt: true,
          },
          orderBy: { paidAt: "asc" },
        });
  const paymentsAllTime =
    bookingIds.length === 0
      ? []
      : await db.raw.payment.findMany({
          where: {
            tenantId,
            status: "CONFIRMED",
            bookingId: { in: bookingIds },
          },
          select: {
            id: true,
            bookingId: true,
            amount: true,
            currency: true,
            paidAt: true,
          },
          orderBy: { paidAt: "asc" },
        });

  // Payments sum by booking (in selected range)
  const paidByBookingInRange = new Map<string, number>();
  for (const p of paymentsInRange) {
    const amt = Number(p.amount?.toString?.() ?? p.amount ?? 0);
    paidByBookingInRange.set(p.bookingId, (paidByBookingInRange.get(p.bookingId) || 0) + amt);
  }

  // Payments sum by booking (all time, used for true outstanding balance)
  const paidByBookingAllTime = new Map<string, number>();
  for (const p of paymentsAllTime) {
    const amt = Number(p.amount?.toString?.() ?? p.amount ?? 0);
    paidByBookingAllTime.set(p.bookingId, (paidByBookingAllTime.get(p.bookingId) || 0) + amt);
  }

  // Daily buckets
  const dayMap = new Map<
    string,
    {
      day: string;
      bookingsCreated: number;
      checkIns: number;
      totalBookingAmount: number;
      totalPaid: number;
      outstanding: number;
    }
  >();

  function ensureDay(day: string) {
    if (!dayMap.has(day)) {
      dayMap.set(day, {
        day,
        bookingsCreated: 0,
        checkIns: 0,
        totalBookingAmount: 0,
        totalPaid: 0,
        outstanding: 0,
      });
    }
    return dayMap.get(day)!;
  }

  let bookingsCount = 0;
  let checkedInCount = 0;
  let totalBookingAmount = 0;
  let totalPaid = 0;
  let outstanding = 0;

  for (const b of bookings) {
    bookingsCount += 1;
    if (b.checkedInAt) checkedInCount += 1;

    const day = isoDay(b.createdAt);
    const bucket = ensureDay(day);
    bucket.bookingsCreated += 1;

    const totalBill = computeTotalBillFromBaseAndCharges(
      Number(b.totalAmount?.toString?.() ?? b.totalAmount ?? 0),
      b.charges ?? []
    );
    totalBookingAmount += totalBill;
    bucket.totalBookingAmount += totalBill;

    const paidInRange = paidByBookingInRange.get(b.id) || 0;
    totalPaid += paidInRange;
    bucket.totalPaid += paidInRange;

    const paidAllTime = paidByBookingAllTime.get(b.id) || 0;
    const bal = Math.max(0, totalBill - paidAllTime);
    outstanding += bal;
    bucket.outstanding += bal;
  }

  // check-ins per day (by checkedInAt)
  for (const b of bookings) {
    if (!b.checkedInAt) continue;
    const day = isoDay(b.checkedInAt);
    ensureDay(day).checkIns += 1;
  }

  const daily = Array.from(dayMap.values()).sort((a, b) => a.day.localeCompare(b.day));

  const topOutstanding = bookings
    .map((b) => {
      const totalBill = computeTotalBillFromBaseAndCharges(
        Number(b.totalAmount?.toString?.() ?? b.totalAmount ?? 0),
        b.charges ?? []
      );
      const paid = paidByBookingAllTime.get(b.id) || 0;
      const bal = Math.max(0, totalBill - paid);

      return {
        bookingId: b.id,
        guestName: b.guestName ?? "",
        propertyName: b.unit?.property?.name ?? "",
        unitName: b.unit?.name ?? "",
        status: String(b.status),
        paymentStatus: String(b.paymentStatus),
        totalAmount: totalBill.toFixed(2),
        paidTotal: paid.toFixed(2),
        outstanding: bal.toFixed(2),
        currency: b.currency ?? "NGN",
        createdAt: isoDay(b.createdAt),
      };
    })
    .filter((x) => Number(x.outstanding) > 0)
    .sort((a, b) => Number(b.outstanding) - Number(a.outstanding));

  const earlyCheckoutEvents = await db.raw.checkEvent.findMany({
    where: {
      tenantId,
      type: "CHECK_OUT",
      earlyCheckout: true,
      capturedAt: { gte: from, lt: toExclusive },
      ...(propertyId ? { booking: { unit: { propertyId } } } : {}),
      ...(unitId ? { booking: { unitId } } : {}),
    },
    select: {
      id: true,
      capturedAt: true,
      refundPolicy: true,
      refundEligibleAmount: true,
      refundApproved: true,
      refundAmount: true,
      refundStatus: true,
      refundReason: true,
      booking: {
        select: {
          id: true,
          guestName: true,
          unit: {
            select: {
              name: true,
              property: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { capturedAt: "desc" },
    take: 100,
  });

  const refundAmountTotal = earlyCheckoutEvents.reduce(
    (sum, x) => sum + Number(x.refundAmount?.toString?.() ?? x.refundAmount ?? 0),
    0
  );
  const refundEligibleTotal = earlyCheckoutEvents.reduce(
    (sum, x) => sum + Number(x.refundEligibleAmount?.toString?.() ?? x.refundEligibleAmount ?? 0),
    0
  );
  const refundApprovedCount = earlyCheckoutEvents.filter((x) => Boolean(x.refundApproved)).length;
  const earlyCheckouts = earlyCheckoutEvents.map((x) => ({
    checkEventId: x.id,
    bookingId: x.booking?.id ?? "",
    guestName: x.booking?.guestName ?? "",
    propertyName: x.booking?.unit?.property?.name ?? "",
    unitName: x.booking?.unit?.name ?? "",
    checkedOutAt: isoDay(x.capturedAt),
    refundPolicy: x.refundPolicy ?? null,
    refundEligibleAmount: Number(x.refundEligibleAmount?.toString?.() ?? x.refundEligibleAmount ?? 0).toFixed(2),
    refundApproved: Boolean(x.refundApproved),
    refundAmount: Number(x.refundAmount?.toString?.() ?? x.refundAmount ?? 0).toFixed(2),
    refundStatus: x.refundStatus ?? null,
    refundReason: x.refundReason ?? null,
  }));

  const overstayedBookings = await db.raw.booking.findMany({
    where: {
      tenantId,
      status: "CHECKED_IN",
      checkOut: { lt: new Date() },
      ...(propertyId ? { unit: { propertyId } } : {}),
      ...(unitId ? { unitId } : {}),
    },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      totalAmount: true,
      currency: true,
      guestName: true,
      unit: {
        select: {
          name: true,
          property: { select: { name: true } },
        },
      },
      charges: {
        where: {
          status: "OPEN",
          OR: [
            { title: { startsWith: "Overstay", mode: "insensitive" } },
            { title: { startsWith: "Overstay night", mode: "insensitive" } },
          ],
        },
        select: { amount: true },
      },
    },
    orderBy: { checkOut: "asc" },
    take: 200,
  });

  const overstays = overstayedBookings.map((b) => {
    const now = Date.now();
    const checkoutMs = new Date(b.checkOut).getTime();
    const checkinMs = new Date(b.checkIn).getTime();
    const daysOverstayed = Math.max(1, Math.floor((now - checkoutMs) / (1000 * 60 * 60 * 24)));
    const bookedNights = Math.max(1, Math.ceil((checkoutMs - checkinMs) / (1000 * 60 * 60 * 24)));
    const nightlyRate = bookedNights > 0 ? Number(b.totalAmount ?? 0) / bookedNights : 0;
    const estimatedOverstay = Math.max(0, daysOverstayed * nightlyRate);
    const postedOverstay = (b.charges || []).reduce((sum, c) => sum + Number(c.amount?.toString?.() ?? c.amount ?? 0), 0);
    return {
      bookingId: b.id,
      guestName: b.guestName ?? "",
      propertyName: b.unit?.property?.name ?? "",
      unitName: b.unit?.name ?? "",
      scheduledCheckout: isoDay(b.checkOut),
      daysOverstayed,
      estimatedOverstay: estimatedOverstay.toFixed(2),
      postedOverstay: postedOverstay.toFixed(2),
      currency: b.currency ?? "NGN",
    };
  });
  const overstayAmountTotal = overstays.reduce((sum, x) => sum + Number(x.postedOverstay), 0);

  const totalUnits = await db.raw.unit.count({
    where: {
      tenantId,
      ...(propertyId ? { propertyId } : {}),
      ...(unitId ? { id: unitId } : {}),
    },
  });

  const occupiedUnits = await db.raw.booking
    .findMany({
      where: {
        tenantId,
        status: "CHECKED_IN",
        ...(propertyId ? { unit: { propertyId } } : {}),
        ...(unitId ? { unitId } : {}),
      },
      select: { unitId: true },
      distinct: ["unitId"],
    })
    .then((rows) => rows.length);

  const occupancyRate = totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;

  const damageCharges = await db.raw.bookingCharge.findMany({
    where: {
      tenantId,
      type: "DAMAGE",
      status: "OPEN",
      createdAt: { gte: from, lt: toExclusive },
      ...(Object.keys(bookingScope).length ? { booking: bookingScope } : {}),
    },
    select: {
      id: true,
      bookingId: true,
      title: true,
      amount: true,
      currency: true,
      createdAt: true,
      booking: {
        select: {
          guestName: true,
          unit: {
            select: {
              name: true,
              property: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const damagesAmountTotal = damageCharges.reduce(
    (sum, x) => sum + Number(x.amount?.toString?.() ?? x.amount ?? 0),
    0
  );
  const damages = damageCharges.map((x) => ({
    chargeId: x.id,
    bookingId: x.bookingId,
    title: x.title,
    amount: Number(x.amount?.toString?.() ?? x.amount ?? 0).toFixed(2),
    currency: x.currency ?? "NGN",
    createdAt: isoDay(x.createdAt),
    guestName: x.booking?.guestName ?? "",
    propertyName: x.booking?.unit?.property?.name ?? "",
    unitName: x.booking?.unit?.name ?? "",
  }));

  return {
    range: { from: isoDay(from), to: isoDay(to) },
    summary: {
      bookingsCount,
      checkedInCount,
      totalBookingAmount: totalBookingAmount.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      outstanding: outstanding.toFixed(2),
      currency: "NGN",
      earlyCheckoutCount: earlyCheckoutEvents.length,
      refundApprovedCount,
      refundEligibleTotal: refundEligibleTotal.toFixed(2),
      refundAmountTotal: refundAmountTotal.toFixed(2),
      overstayCount: overstays.length,
      overstayAmountTotal: overstayAmountTotal.toFixed(2),
      totalUnits,
      occupiedUnits,
      occupancyRate: Number(occupancyRate.toFixed(2)),
      damagesCount: damages.length,
      damagesAmountTotal: damagesAmountTotal.toFixed(2),
    },
    daily,
    topOutstanding,
    earlyCheckouts,
    overstays,
    damages,
  };
}

/* ================= HANDLERS ================= */

// ✅ JSON endpoint
export const bookingsPaymentsReport = asyncHandler(async (req: Request, res: Response) => {
  const report = await buildBookingsPaymentsReport(req);
  res.json(report);
});

// ✅ CSV: Daily
export const exportBookingsPaymentsDailyCsv = asyncHandler(async (req: Request, res: Response) => {
  const report = await buildBookingsPaymentsReport(req);

  const rows = report.daily.map((d) => ({
    date: d.day,
    bookings: d.bookingsCreated,
    checkIns: d.checkIns,
    bookingValue: d.totalBookingAmount.toFixed(2),
    paid: d.totalPaid.toFixed(2),
    outstanding: d.outstanding.toFixed(2),
  }));

  const csv = toCsv(rows, ["date", "bookings", "checkIns", "bookingValue", "paid", "outstanding"]);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="bookings-payments-daily_${report.range.from}_${report.range.to}.csv"`
  );
  res.status(200).send(csv);
});

// ✅ CSV: Outstanding
export const exportBookingsPaymentsOutstandingCsv = asyncHandler(async (req: Request, res: Response) => {
  const report = await buildBookingsPaymentsReport(req);

  const rows = report.topOutstanding.map((x) => ({
    bookingId: x.bookingId,
    guestName: x.guestName,
    property: x.propertyName,
    unit: x.unitName,
    status: x.status,
    paymentStatus: x.paymentStatus,
    totalAmount: x.totalAmount,
    paidTotal: x.paidTotal,
    outstanding: x.outstanding,
    currency: x.currency,
    createdAt: x.createdAt,
  }));

  const csv = toCsv(rows, [
    "bookingId",
    "guestName",
    "property",
    "unit",
    "status",
    "paymentStatus",
    "totalAmount",
    "paidTotal",
    "outstanding",
    "currency",
    "createdAt",
  ]);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="outstanding-bookings_${report.range.from}_${report.range.to}.csv"`
  );
  res.status(200).send(csv);
});
