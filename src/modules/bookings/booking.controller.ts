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

  const {
    unitId,
    checkIn,
    checkOut,
    guestName,
    guestEmail,
    guestPhone,
    totalAmount,
    currency,
  } = req.body;

  if (!unitId) throw new AppError("unitId is required", 400, "VALIDATION_ERROR");

  const start = toDate(checkIn, "checkIn");
  const end = toDate(checkOut, "checkOut");
  if (end <= start) throw new AppError("checkOut must be after checkIn", 400, "VALIDATION_ERROR");

  // Validate totalAmount for Prisma Decimal
  if (totalAmount !== undefined && totalAmount !== null && typeof totalAmount !== "string") {
    throw new AppError('totalAmount must be a string like "45000.00"', 400, "VALIDATION_ERROR");
  }
  if (currency !== undefined && currency !== null && typeof currency !== "string") {
    throw new AppError("currency must be a string", 400, "VALIDATION_ERROR");
  }

  // ✅ Your tenant DB wrapper supports findById (not Prisma findUnique)
  const unit = await db.unit.findById(unitId);
  if (!unit) throw new AppError("Unit not found", 404, "UNIT_NOT_FOUND");

  // Overlap check:
  const conflict = await db.booking.findMany({
    where: {
      unitId,
      status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
      AND: [{ checkIn: { lt: end } }, { checkOut: { gt: start } }],
    },
    take: 1,
  });

  if (conflict.length > 0) {
    throw new AppError("Unit is not available for the selected dates", 409, "UNIT_NOT_AVAILABLE");
  }

  const booking = await db.booking.create({
    data: {
      tenantId, // ✅ required by your schema
      unitId,
      checkIn: start,
      checkOut: end,
      guestName: guestName ?? null,
      guestEmail: guestEmail ?? null,
      guestPhone: guestPhone ?? null,
      totalAmount: totalAmount ?? null, // ✅ now saved
      currency: currency ?? "NGN",
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

export const arrivalsWeek = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  // end = start + 7 days (exclusive) => covers today..+6
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const bookings = await db.raw.booking.findMany({
    where: {
      tenantId,
      status: { in: ["PENDING", "CONFIRMED"] },
      checkIn: { gte: start, lt: end },
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

export const checkInBooking = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const bookingId = req.params.id;

  const {
    notes,
    guestName,
    guestPhone,
    guestEmail,
    address,
    nationality,
    idType,
    idNumber,
    idIssuedBy,
    vehiclePlate,
  } = req.body ?? {};

  // Load booking (must be tenant-safe)
  const existing = await db.raw.booking.findFirst({
    where: { tenantId, id: bookingId },
    select: { id: true, status: true, checkedInAt: true },
  });

  if (!existing) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

  // Only confirmed can be checked in
  if (String(existing.status).toUpperCase() !== "CONFIRMED") {
    throw new AppError("Only CONFIRMED bookings can be checked in", 400, "INVALID_STATUS");
  }

  // Block double check-in
  if (existing.checkedInAt) {
    throw new AppError("Booking already checked in", 409, "ALREADY_CHECKED_IN");
  }

  // ✅ Update booking with check-in metadata
  // IMPORTANT: the fields below must exist on your Booking model in Prisma.
  const updated = await db.raw.booking.update({
    where: { id: bookingId }, // tenant is enforced by the findFirst above; you can also use { id_tenantId: ... } if you have a compound unique
    data: {
      status: "CHECKED_IN",
      checkedInAt: new Date(),
      checkInNotes: notes ?? null,

      // optionally update the main guest fields at check-in
      guestName: guestName ?? undefined,
      guestPhone: guestPhone ?? undefined,
      guestEmail: guestEmail ?? undefined,

      // additional check-in fields
      guestAddress: address ?? null,
      guestNationality: nationality ?? null,

      idType: idType ?? null,
      idNumber: idNumber ?? null,
      idIssuedBy: idIssuedBy ?? null,

      vehiclePlate: vehiclePlate ?? null,
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
  });

  res.json({ booking: updated });
});

export const recordBookingPayment = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const bookingId = req.params.id;
  const { amount, currency, reference, notes } = req.body ?? {};

  // amount must be string (frontend sends string)
  if (!amount || typeof amount !== "string") {
    throw new AppError('amount is required and must be a string like "45000.00"', 400, "VALIDATION_ERROR");
  }

  if (currency !== undefined && currency !== null && typeof currency !== "string") {
    throw new AppError("currency must be a string", 400, "VALIDATION_ERROR");
  }

  if (reference !== undefined && reference !== null && typeof reference !== "string") {
    throw new AppError("reference must be a string", 400, "VALIDATION_ERROR");
  }

  const result = await db.raw.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, tenantId },
      select: { id: true, totalAmount: true, currency: true, paymentStatus: true },
    });

    if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
    if (!booking.totalAmount) throw new AppError("Booking has no totalAmount", 400, "BOOKING_TOTAL_MISSING");

    // ✅ create payment as CONFIRMED
    const payment = await tx.payment.create({
      data: {
        tenantId,
        bookingId,
        amount, // Prisma Decimal accepts string
        currency: currency ?? booking.currency ?? "NGN",
        reference: reference ?? null,
        notes: notes ?? null,
        method: "MANUAL",
        status: "CONFIRMED",
        paidAt: new Date(),
        confirmedAt: new Date(),
        confirmedByUserId: (req as any).user?.id ?? null, // if you store user on req
      },
    });

    // ✅ sum CONFIRMED payments
    const agg = await tx.payment.aggregate({
      where: { tenantId, bookingId, status: "CONFIRMED" },
      _sum: { amount: true },
    });

    const paidTotal = Number((agg._sum.amount ?? 0).toString());
    const bookingTotal = Number(booking.totalAmount.toString());

    let nextStatus: "UNPAID" | "PARTPAID" | "PAID" = "UNPAID";
    if (paidTotal <= 0) nextStatus = "UNPAID";
    else if (paidTotal + 1e-9 < bookingTotal) nextStatus = "PARTPAID";
    else nextStatus = "PAID";

const updatedBooking = await tx.booking.update({
  where: { id: bookingId },
  data: {
    paymentStatus: nextStatus,
    // ✅ status should become CONFIRMED once any payment is made
    status:
      nextStatus === "UNPAID"
        ? "PENDING"
        : "CONFIRMED",
  },
  select: { id: true, paymentStatus: true, status: true, totalAmount: true, currency: true },
});


    return {
      payment,
      booking: updatedBooking,
      paidTotal: paidTotal.toFixed(2),
    };
  });

  res.status(201).json(result);
});


export const pendingPayments = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const bookings = await db.raw.booking.findMany({
    where: {
      tenantId,
      paymentStatus: { in: ["UNPAID", "PARTPAID"] },
      totalAmount: { not: null },
      status: { notIn: ["CANCELLED", "NO_SHOW", "CHECKED_OUT"] },
    },
    select: {
      id: true,
      guestName: true,
      totalAmount: true,
      currency: true,
      status: true,
      paymentStatus: true,
      unit: { select: { name: true, property: { select: { name: true } } } },
      payments: {
        where: { status: "CONFIRMED" },
        select: { amount: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const items = bookings
    .map((b) => {
      const total = Number(b.totalAmount?.toString() ?? 0);
      const paid = (b.payments || []).reduce((sum, p) => sum + Number(p.amount.toString()), 0);
      const outstanding = Math.max(0, total - paid);

      return {
        bookingId: b.id,
        guestName: b.guestName,
        unitName: b.unit?.property?.name ? `${b.unit.property.name} — ${b.unit.name}` : b.unit?.name,
        bookingStatus: b.status,
        paymentStatus: b.paymentStatus,
        totalAmount: total.toFixed(2),
        paidTotal: paid.toFixed(2),
        outstanding: outstanding.toFixed(2),
        currency: b.currency ?? "NGN",
      };
    })
    .filter((x) => Number(x.outstanding) > 0);

  res.json({ items });
});
