// src/modules/bookings/booking.controller.ts
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";

import { asyncHandler } from "../../common/utils/asyncHandler";
import { AppError } from "../../common/errors/AppError";
import { prismaForTenant } from "../../../prisma/tenantPrisma";
import { logger } from "../../common/logger/logger";
import { sendAdminBookingAlertEmail, sendGuestBookingEmail } from "../../common/notifications/email";
import {
  createPresignedGetUrlFromKey,
  createPresignedPutUrl,
  isS3StorageEnabled,
  publicUrlFromKey,
  storageObjectExists,
  uploadBufferToStorage,
} from "../../common/storage/object-storage";

/**
 * Helpers
 */
function toDate(value: any, field: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`${field} must be a valid date`, 400, "VALIDATION_ERROR");
  }
  return d;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeImageExt(mime: string) {
  return mime === "image/png" ? "png" : "jpg";
}

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/jpg", "image/png"]);
const MAX_GUEST_PHOTO_BYTES = 300 * 1024;

function withGuestPhotoUrl<T extends { guestPhotoKey?: string | null }>(b: T) {
  return { ...b, guestPhotoUrl: publicUrlFromKey(b.guestPhotoKey) };
}

function normalizeOptionalString(value: unknown) {
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
 * Controllers
 */
export const createBooking = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const user = req.user;

  const {
    unitId,
    checkIn,
    checkOut,
    guestId, // ✅ NEW
    totalAmount,
    currency,
  } = req.body;

  if (!unitId) throw new AppError("unitId is required", 400, "VALIDATION_ERROR");
  if (!guestId) throw new AppError("guestId is required", 400, "VALIDATION_ERROR");

  const start = toDate(checkIn, "checkIn");
  const end = toDate(checkOut, "checkOut");
  if (end <= start) throw new AppError("checkOut must be after checkIn", 400, "VALIDATION_ERROR");

  if (totalAmount !== undefined && totalAmount !== null && typeof totalAmount !== "string") {
    throw new AppError('totalAmount must be a string like "45000.00"', 400, "VALIDATION_ERROR");
  }
  if (currency !== undefined && currency !== null && typeof currency !== "string") {
    throw new AppError("currency must be a string", 400, "VALIDATION_ERROR");
  }

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

  const result = await db.raw.$transaction(async (tx) => {
    // ✅ Load guest (and ensure tenant match)
    const guest = await tx.guest.findFirst({
      where: { id: guestId, tenantId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        address: true,
        nationality: true,
        idType: true,
        idNumber: true,
        idIssuedBy: true,
        vehiclePlate: true,
      },
    });

    if (!guest) throw new AppError("Guest not found", 404, "GUEST_NOT_FOUND");

    // ✅ Create booking linked to guest + snapshot fields
    const booking = await tx.booking.create({
      data: {
        tenantId,
        unitId,
        guestId: guest.id, // ✅ IMPORTANT
        checkIn: start,
        checkOut: end,

        // snapshot
        guestName: guest.fullName ?? null,
        guestEmail: guest.email ?? null,
        guestPhone: guest.phone ?? null,
        guestAddress: guest.address ?? null,
        guestNationality: guest.nationality ?? null,
        idType: guest.idType ?? null,
        idNumber: guest.idNumber ?? null,
        idIssuedBy: guest.idIssuedBy ?? null,
        vehiclePlate: guest.vehiclePlate ?? null,

        totalAmount: totalAmount ?? null,
        currency: currency ?? "NGN",
        status: "PENDING",
        paymentStatus: "UNPAID",
      },
      include: {
        guest: { select: { id: true, fullName: true, email: true, phone: true } }, // ✅ return guest
        unit: { select: { name: true, property: { select: { name: true } } } },
      },
    });

    // ✅ Auto-create ROOM charge if totalAmount is present
    if (totalAmount) {
      await tx.bookingCharge.create({
        data: {
          tenantId,
          bookingId: booking.id,
          type: "ROOM",
          title: "Room charge",
          amount: totalAmount,
          currency: currency ?? booking.currency ?? "NGN",
          status: "OPEN",
        },
      });
    }

    return booking;
  });

  logger.info(
    {
      event: "audit.booking_created",
      requestId: req.requestId,
      tenantId,
      bookingId: (result as any).id,
      unitId,
      guestId,
      actorUserId: user?.userId ?? null,
    },
    "Audit booking created"
  );

  const bookingRecord: any = result;
  if (bookingRecord?.guestEmail) {
    sendGuestBookingEmail({
      to: String(bookingRecord.guestEmail),
      guestName: bookingRecord.guestName ?? bookingRecord.guest?.fullName ?? null,
      bookingId: bookingRecord.id,
      tenantName: req.tenant?.name ?? null,
      propertyName: bookingRecord?.unit?.property?.name ?? null,
      unitName: bookingRecord?.unit?.name ?? null,
      checkIn: bookingRecord.checkIn,
      checkOut: bookingRecord.checkOut,
      totalAmount: bookingRecord.totalAmount?.toString?.() ?? bookingRecord.totalAmount ?? null,
      currency: bookingRecord.currency ?? "NGN",
    }).catch((err) => {
      logger.warn(
        { event: "notify.booking_email_failed", tenantId, bookingId: bookingRecord.id, error: String(err) },
        "Failed to send booking email"
      );
    });
  }

  const adminRecipients = await db.raw.user.findMany({
    where: { tenantId, role: "ADMIN", status: "ACTIVE" },
    select: { email: true },
  });

  for (const admin of adminRecipients) {
    const to = String(admin.email || "").trim();
    if (!to) continue;
    sendAdminBookingAlertEmail({
      to,
      guestName: bookingRecord.guestName ?? bookingRecord.guest?.fullName ?? null,
      bookingId: bookingRecord.id,
      tenantName: req.tenant?.name ?? null,
      propertyName: bookingRecord?.unit?.property?.name ?? null,
      unitName: bookingRecord?.unit?.name ?? null,
      checkIn: bookingRecord.checkIn,
      checkOut: bookingRecord.checkOut,
      totalAmount: bookingRecord.totalAmount?.toString?.() ?? bookingRecord.totalAmount ?? null,
      currency: bookingRecord.currency ?? "NGN",
    }).catch((err) => {
      logger.warn(
        { event: "notify.booking_admin_email_failed", tenantId, bookingId: bookingRecord.id, adminEmail: to, error: String(err) },
        "Failed to send admin booking alert email"
      );
    });
  }

  res.status(201).json({ booking: withGuestPhotoUrl(result as any) });
});

export const listBookings = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const { unitId, status, paymentStatus, from, to, q, limit = "50", cursor, activeOnly } = req.query as Record<
    string,
    string | undefined
  >;

  const take = Math.min(parseInt(limit, 10) || 50, 200);

  const where: any = { tenantId, ...(unitId ? { unitId } : {}), ...(status ? { status } : {}), ...(paymentStatus ? { paymentStatus } : {}) };
  if (activeOnly === "1" || activeOnly === "true") {
    where.status = { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] };
  }

  if (from || to) {
    where.checkIn = {
      ...(from ? { gte: toDate(from, "from") } : {}),
      ...(to ? { lte: toDate(to, "to") } : {}),
    };
  }

  if (q?.trim()) {
    const s = q.trim();
    where.OR = [
      { guestName: { contains: s, mode: "insensitive" } },
      { guestEmail: { contains: s, mode: "insensitive" } },
      { guest: { fullName: { contains: s, mode: "insensitive" } } }, // ✅ NEW
      { guest: { email: { contains: s, mode: "insensitive" } } },    // ✅ NEW
      { guest: { phone: { contains: s, mode: "insensitive" } } },    // ✅ NEW
    ];
  }

  const bookings = await db.raw.booking.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      guest: { select: { id: true, fullName: true, email: true, phone: true } }, // ✅ IMPORTANT
      charges: {
        where: { status: "OPEN" },
        select: { amount: true, type: true },
      },
      payments: {
        where: { status: "CONFIRMED" },
        select: { amount: true },
      },
    },
  });

  const items = bookings.map((b: any) => {
    const totalBill = computeTotalBillFromBaseAndCharges(
      Number(b.totalAmount?.toString?.() ?? b.totalAmount ?? 0),
      b.charges || []
    );
    const paidTotal = (b.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount.toString()), 0);
    const outstandingAmount = Math.max(0, totalBill - paidTotal);

    return {
      ...withGuestPhotoUrl(b),
      totalBill: totalBill.toFixed(2),
      paidTotal: paidTotal.toFixed(2),
      outstandingAmount: outstandingAmount.toFixed(2),
    };
  });

  const nextCursor = items.length === take ? items[items.length - 1]?.id ?? null : null;
  res.json({ bookings: items, pagination: { nextCursor, hasMore: Boolean(nextCursor) } });
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
      guest: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          address: true,
          nationality: true,
          idType: true,
          idNumber: true,
          idIssuedBy: true,
          vehiclePlate: true,
        },
      },
    },
    orderBy: { checkIn: "asc" },
  });

  const rows = await Promise.all(
    bookings.map(async (b: any) => ({
      ...b,
      guestPhotoUrl: b.guestPhotoKey
        ? await createPresignedGetUrlFromKey({ key: b.guestPhotoKey, expiresInSec: 3600 })
        : publicUrlFromKey(b.guestPhotoKey),
    }))
  );

  res.json({ bookings: rows });
});

export const arrivalsWeek = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const start = new Date();
  start.setHours(0, 0, 0, 0);

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
      guest: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          address: true,
          nationality: true,
          idType: true,
          idNumber: true,
          idIssuedBy: true,
          vehiclePlate: true,
        },
      },
    },
    orderBy: { checkIn: "asc" },
  });

  const rows = await Promise.all(
    bookings.map(async (b: any) => ({
      ...b,
      guestPhotoUrl: b.guestPhotoKey
        ? await createPresignedGetUrlFromKey({ key: b.guestPhotoKey, expiresInSec: 3600 })
        : publicUrlFromKey(b.guestPhotoKey),
    }))
  );

  res.json({ bookings: rows });
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
              { guest: { fullName: { contains: search, mode: "insensitive" } } },
              { guest: { email: { contains: search, mode: "insensitive" } } },
              { guest: { phone: { contains: search, mode: "insensitive" } } },
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
      guest: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
        },
      },
      charges: {
        where: { status: "OPEN" },
        select: { amount: true, type: true },
      },
      payments: {
        where: { status: "CONFIRMED" },
        select: { amount: true },
      },
    },
    orderBy: { checkedInAt: "desc" },
  });

  const items = await Promise.all(bookings.map(async (b: any) => {
    const totalBill = computeTotalBillFromBaseAndCharges(
      Number(b.totalAmount?.toString?.() ?? b.totalAmount ?? 0),
      b.charges || []
    );
    const paidTotal = (b.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount.toString()), 0);
    const outstandingAmount = Math.max(0, totalBill - paidTotal);

    return {
      ...b,
      guestPhotoUrl: b.guestPhotoKey
        ? await createPresignedGetUrlFromKey({ key: b.guestPhotoKey, expiresInSec: 3600 })
        : publicUrlFromKey(b.guestPhotoKey),
      totalBill: totalBill.toFixed(2),
      paidTotal: paidTotal.toFixed(2),
      outstandingAmount: outstandingAmount.toFixed(2),
    };
  }));

  res.json({ bookings: items });
});

export const checkInBooking = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const bookingId = normalizeOptionalString(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (!bookingId) throw new AppError("booking id is required", 400, "VALIDATION_ERROR");

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
    updateGuestProfile,
  } = req.body ?? {};
  const shouldUpdateGuestProfile = toBoolean(updateGuestProfile);

  const incoming = {
    guestName: normalizeOptionalString(guestName),
    guestPhone: normalizeOptionalString(guestPhone),
    guestEmail: normalizeOptionalString(guestEmail),
    guestAddress: normalizeOptionalString(address),
    guestNationality: normalizeOptionalString(nationality),
    idType: normalizeOptionalString(idType),
    idNumber: normalizeOptionalString(idNumber),
    idIssuedBy: normalizeOptionalString(idIssuedBy),
    vehiclePlate: normalizeOptionalString(vehiclePlate),
    checkInNotes: normalizeOptionalString(notes),
  };

  const updated = await db.raw.$transaction(async (tx) => {
    const existing = await tx.booking.findFirst({
      where: { tenantId, id: bookingId },
      select: {
        id: true,
        status: true,
        checkedInAt: true,
        guestId: true,
      },
    });

    if (!existing) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

    if (String(existing.status).toUpperCase() !== "CONFIRMED") {
      throw new AppError("Only CONFIRMED bookings can be checked in", 400, "INVALID_STATUS");
    }

    if (existing.checkedInAt) {
      throw new AppError("Booking already checked in", 409, "ALREADY_CHECKED_IN");
    }

    const bookingUpdateData: Record<string, any> = {
      status: "CHECKED_IN",
      checkedInAt: new Date(),
      checkInNotes: incoming.checkInNotes ?? null,
    };

    if (incoming.guestName !== null) bookingUpdateData.guestName = incoming.guestName;
    if (incoming.guestPhone !== null) bookingUpdateData.guestPhone = incoming.guestPhone;
    if (incoming.guestEmail !== null) bookingUpdateData.guestEmail = incoming.guestEmail;
    if (incoming.guestAddress !== null) bookingUpdateData.guestAddress = incoming.guestAddress;
    if (incoming.guestNationality !== null) bookingUpdateData.guestNationality = incoming.guestNationality;
    if (incoming.idType !== null) bookingUpdateData.idType = incoming.idType;
    if (incoming.idNumber !== null) bookingUpdateData.idNumber = incoming.idNumber;
    if (incoming.idIssuedBy !== null) bookingUpdateData.idIssuedBy = incoming.idIssuedBy;
    if (incoming.vehiclePlate !== null) bookingUpdateData.vehiclePlate = incoming.vehiclePlate;

    const booking = await tx.booking.update({
      where: { id: bookingId },
      data: bookingUpdateData,
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

    if (shouldUpdateGuestProfile && existing.guestId) {
      const guestUpdateData: Record<string, any> = {};
      if (incoming.guestName !== null) guestUpdateData.fullName = incoming.guestName;
      if (incoming.guestPhone !== null) guestUpdateData.phone = incoming.guestPhone;
      if (incoming.guestEmail !== null) guestUpdateData.email = incoming.guestEmail;
      if (incoming.guestAddress !== null) guestUpdateData.address = incoming.guestAddress;
      if (incoming.guestNationality !== null) guestUpdateData.nationality = incoming.guestNationality;
      if (incoming.idType !== null) guestUpdateData.idType = incoming.idType;
      if (incoming.idNumber !== null) guestUpdateData.idNumber = incoming.idNumber;
      if (incoming.idIssuedBy !== null) guestUpdateData.idIssuedBy = incoming.idIssuedBy;
      if (incoming.vehiclePlate !== null) guestUpdateData.vehiclePlate = incoming.vehiclePlate;

      if (Object.keys(guestUpdateData).length > 0) {
        await tx.guest.update({
          where: { id: existing.guestId },
          data: guestUpdateData,
        });
      }
    }

    return booking;
  });

  res.json({ booking: withGuestPhotoUrl(updated as any) });
});

/**
 * NEW: Upload guest photo (demo: save to local disk)
 * Expects multer middleware to populate req.file (field name: "file")
 * Route example:
 *   router.post("/api/bookings/:id/guest-photo", imageUpload({ maxSizeKb: 300 }).single("file"), uploadGuestPhoto)
 */
export const uploadGuestPhoto = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const bookingId = req.params.id;

  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new AppError("No photo uploaded", 400, "VALIDATION_ERROR");

  // Ensure booking belongs to tenant
  const booking = await db.raw.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: { id: true },
  });
  if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

  const ext = safeImageExt(file.mimetype);

  // Stable key for either S3 or local fallback
  const relativeDir = path.join("tenants", tenantId, "bookings", bookingId);
  const filename = `guest.${ext}`;
  const photoKey = path.join(relativeDir, filename).replace(/\\/g, "/");

  if (isS3StorageEnabled()) {
    await uploadBufferToStorage({
      key: photoKey,
      body: file.buffer,
      contentType: file.mimetype,
    });
  } else {
    // Local dev fallback: save to uploads/tenants/<tenantId>/bookings/<bookingId>/guest.<ext>
    const uploadRoot = path.join(process.cwd(), "uploads");
    const absoluteDir = path.join(uploadRoot, relativeDir);
    ensureDir(absoluteDir);
    const absolutePath = path.join(absoluteDir, filename);
    fs.writeFileSync(absolutePath, file.buffer);
  }

  await db.raw.booking.update({
    where: { id: bookingId },
    data: {
      guestPhotoKey: photoKey,
      guestPhotoMime: file.mimetype,
      guestPhotoSize: file.size,
      guestPhotoUpdatedAt: new Date(),
    },
    select: { id: true },
  });

  res.json({
    photoKey,
    photoUrl: publicUrlFromKey(photoKey),
    size: file.size,
    mime: file.mimetype,
  });
});

export const presignGuestPhotoUpload = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const bookingId = req.params.id;
  const { contentType, fileSize } = req.body ?? {};

  if (!isS3StorageEnabled()) {
    throw new AppError("Direct upload is available only when STORAGE_DRIVER=S3", 400, "STORAGE_NOT_CONFIGURED");
  }

  if (!contentType || typeof contentType !== "string" || !ALLOWED_IMAGE_MIME.has(contentType)) {
    throw new AppError("contentType must be image/jpeg, image/jpg or image/png", 400, "VALIDATION_ERROR");
  }

  const parsedSize = Number(fileSize ?? 0);
  if (Number.isFinite(parsedSize) && parsedSize > 0 && parsedSize > MAX_GUEST_PHOTO_BYTES) {
    throw new AppError("Photo must be 300KB or less", 400, "FILE_TOO_LARGE");
  }

  const booking = await db.raw.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: { id: true },
  });
  if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

  const ext = safeImageExt(contentType);
  const stamp = Date.now();
  const relativeDir = path.join("tenants", tenantId, "bookings", bookingId);
  const filename = `guest-${stamp}.${ext}`;
  const photoKey = path.join(relativeDir, filename).replace(/\\/g, "/");

  const { uploadUrl, expiresIn } = await createPresignedPutUrl({
    key: photoKey,
    contentType,
    expiresInSec: 300,
  });

  res.json({
    method: "PUT",
    uploadUrl,
    expiresInSeconds: expiresIn,
    photoKey,
    photoUrl: publicUrlFromKey(photoKey),
    requiredHeaders: {
      "Content-Type": contentType,
    },
  });
});

export const confirmGuestPhotoUpload = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const bookingId = req.params.id;
  const { photoKey, mime, size } = req.body ?? {};

  if (!photoKey || typeof photoKey !== "string") {
    throw new AppError("photoKey is required", 400, "VALIDATION_ERROR");
  }

  const keyPrefix = path.join("tenants", tenantId, "bookings", bookingId).replace(/\\/g, "/");
  const normalizedKey = photoKey.replace(/\\/g, "/");
  if (!normalizedKey.startsWith(`${keyPrefix}/`)) {
    throw new AppError("photoKey is invalid for this tenant/booking", 400, "VALIDATION_ERROR");
  }

  if (mime !== undefined && mime !== null) {
    if (typeof mime !== "string" || !ALLOWED_IMAGE_MIME.has(mime)) {
      throw new AppError("mime must be image/jpeg, image/jpg or image/png", 400, "VALIDATION_ERROR");
    }
  }

  const parsedSize = Number(size ?? 0);
  if (Number.isFinite(parsedSize) && parsedSize > 0 && parsedSize > MAX_GUEST_PHOTO_BYTES) {
    throw new AppError("Photo must be 300KB or less", 400, "FILE_TOO_LARGE");
  }

  const booking = await db.raw.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: { id: true },
  });
  if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

  if (isS3StorageEnabled()) {
    const exists = await storageObjectExists(normalizedKey);
    if (!exists) {
      throw new AppError("Uploaded photo not found in storage. Retry upload.", 400, "STORAGE_OBJECT_MISSING");
    }
  }

  await db.raw.booking.update({
    where: { id: bookingId },
    data: {
      guestPhotoKey: normalizedKey,
      guestPhotoMime: typeof mime === "string" ? mime : null,
      guestPhotoSize: Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : null,
      guestPhotoUpdatedAt: new Date(),
    },
    select: { id: true },
  });

  res.json({
    photoKey: normalizedKey,
    photoUrl: publicUrlFromKey(normalizedKey),
    size: Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : null,
    mime: typeof mime === "string" ? mime : null,
  });
});

export const recordBookingPayment = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const user = req.user;

  const bookingId = req.params.id;
  const { amount, currency, reference, notes } = req.body ?? {};

  if (!amount || typeof amount !== "string") {
    throw new AppError('amount is required and must be a string like "45000.00"', 400, "VALIDATION_ERROR");
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new AppError("amount must be a positive numeric string", 400, "VALIDATION_ERROR");
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
      select: {
        id: true,
        status: true,
        totalAmount: true,
        currency: true,
        paymentStatus: true,
      },
    });

    if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

    // ✅ totalBill from booking total + OPEN extras (or OPEN ROOM charges if itemized)
    const openCharges = await tx.bookingCharge.findMany({
      where: { tenantId, bookingId, status: "OPEN" },
      select: { amount: true, type: true },
    });

    const totalBill = computeTotalBillFromBaseAndCharges(
      Number(booking.totalAmount?.toString?.() ?? booking.totalAmount ?? 0),
      openCharges
    );

    if (totalBill <= 0) {
      throw new AppError("Booking has no bill to pay (no charges/totalAmount)", 400, "BOOKING_TOTAL_MISSING");
    }

    const payment = await tx.payment.create({
      data: {
        tenantId,
        bookingId,
        amount,
        currency: currency ?? booking.currency ?? "NGN",
        reference: reference ?? null,
        notes: notes ?? null,
        method: "MANUAL",
        status: "CONFIRMED",
        paidAt: new Date(),
        confirmedAt: new Date(),
        confirmedByUserId: user?.userId ?? null,
      },
    });

    const payAgg = await tx.payment.aggregate({
      where: { tenantId, bookingId, status: "CONFIRMED" },
      _sum: { amount: true },
    });

    const paidTotal = Number((payAgg._sum.amount ?? 0).toString());
    const outstanding = Math.max(0, totalBill - paidTotal);

    let nextStatus: "UNPAID" | "PARTPAID" | "PAID" = "UNPAID";
    if (paidTotal <= 0) nextStatus = "UNPAID";
    else if (outstanding > 0.009) nextStatus = "PARTPAID";
    else nextStatus = "PAID";

    const nextBookingStatus =
      booking.status === "PENDING" && nextStatus !== "UNPAID" ? "CONFIRMED" : booking.status;

    const updatedBooking = await tx.booking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: nextStatus,
        status: nextBookingStatus,
      },
      select: {
        id: true,
        paymentStatus: true,
        status: true,
        totalAmount: true,
        currency: true,
        guestPhotoKey: true,
      },
    });

    return {
      payment,
      booking: withGuestPhotoUrl(updatedBooking as any),
      paidTotal: paidTotal.toFixed(2),
      totalBill: totalBill.toFixed(2),
      outstanding: outstanding.toFixed(2),
    };
  });

  logger.info(
    {
      event: "audit.booking_payment_recorded",
      requestId: req.requestId,
      tenantId,
      bookingId,
      actorUserId: user?.userId ?? null,
      paymentId: result.payment.id,
      amount: result.payment.amount,
      currency: result.payment.currency,
      outstanding: result.outstanding,
      bookingStatus: result.booking.status,
      paymentStatus: result.booking.paymentStatus,
    },
    "Audit booking payment"
  );

  res.status(201).json(result);
});

export const pendingPayments = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);

  const bookings = await db.raw.booking.findMany({
    where: {
      tenantId,
      status: { notIn: ["CANCELLED", "NO_SHOW", "CHECKED_OUT"] },
    },
    select: {
      id: true,
      guestName: true,
      currency: true,
      status: true,
      paymentStatus: true,
      totalAmount: true,
      guestPhotoKey: true,
      unit: { select: { name: true, property: { select: { name: true } } } },

      // ✅ OPEN charges (room + damage + extras)
      charges: {
        where: { status: "OPEN" },
        select: { amount: true, type: true },
      },

      payments: {
        where: { status: "CONFIRMED" },
        select: { amount: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const items = bookings
    .map((b: any) => {
      const total = computeTotalBillFromBaseAndCharges(
        Number(b.totalAmount?.toString?.() ?? b.totalAmount ?? 0),
        b.charges || []
      );

      const paid = (b.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount.toString()), 0);

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
        guestPhotoUrl: publicUrlFromKey(b.guestPhotoKey),
      };
    })
    .filter((x: any) => Number(x.outstanding) > 0.009);

  res.json({ items });
});
